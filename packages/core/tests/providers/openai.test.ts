import { describe, it, expect, vi } from 'vitest';
import { toOpenAITools } from '../../src/providers/base.js';
import { OpenAIProvider } from '../../src/providers/openai.js';
import type { ToolDefinition, ProviderChatParams } from '../../src/types.js';
import { chatViaTurn } from '../helpers/chat-via-turn.js';

describe('OpenAI provider helpers', () => {
  it('converts tools to OpenAI function format', () => {
    const tools: ToolDefinition[] = [{
      name: 'search',
      description: 'Search the web',
      parameters: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    }];

    const result = toOpenAITools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('search');
    expect(result[0].function.parameters.type).toBe('object');
    expect(result[0].function.parameters.properties).toHaveProperty('query');
  });
});

describe('OpenAI tool call id fallback', () => {
  function makeProvider() {
    return new OpenAIProvider({ type: 'openai', apiKey: 'test-key' });
  }

  async function collect(stream: AsyncGenerator<string>) {
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(chunk);
    return chunks;
  }

  function params(overrides?: Partial<ProviderChatParams>): ProviderChatParams {
    return {
      messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: 1 }],
      systemPrompt: 'You are helpful.',
      tools: [{
        name: 'lookup_order',
        description: 'Look up an order',
        parameters: { orderId: { type: 'string', description: 'id' } },
        required: ['orderId'],
      }],
      ...overrides,
    };
  }

  function mockCreate(provider: OpenAIProvider, create: ReturnType<typeof vi.fn>) {
    (provider as unknown as { client: { chat: { completions: { create: ReturnType<typeof vi.fn> } } } })
      .client.chat.completions.create = create;
  }

  it('gives two tool calls without ids two distinct call_<uuid> ids', async () => {
    const provider = makeProvider();
    const capturedIds: string[] = [];

    const create = vi.fn()
      .mockImplementationOnce(() => ({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'lookup_order', arguments: '{"orderId":"1"}' } }] } }] };
          yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
        },
      }))
      .mockImplementationOnce(() => ({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'lookup_order', arguments: '{"orderId":"2"}' } }] } }] };
          yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
        },
      }))
      .mockImplementationOnce(() => ({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'done' } }] };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      }));

    mockCreate(provider, create);

    const toolExecutor = vi.fn().mockImplementation(({ id }: { id: string }) => {
      capturedIds.push(id);
      return Promise.resolve({ success: true, data: {} });
    });

    await collect(chatViaTurn(provider, params({ toolExecutor })));

    expect(capturedIds).toHaveLength(2);
    expect(capturedIds[0]).toMatch(/^call_[0-9a-f-]{36}$/);
    expect(capturedIds[1]).toMatch(/^call_[0-9a-f-]{36}$/);
    expect(capturedIds[0]).not.toBe(capturedIds[1]);
  });

  it('uses the id the API sends when one is present', async () => {
    const provider = makeProvider();
    let capturedId = '';

    const create = vi.fn()
      .mockImplementationOnce(() => ({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_from_api', function: { name: 'lookup_order', arguments: '{"orderId":"1"}' } }] } }] };
          yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
        },
      }))
      .mockImplementationOnce(() => ({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'done' } }] };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      }));

    mockCreate(provider, create);

    const toolExecutor = vi.fn().mockImplementation(({ id }: { id: string }) => {
      capturedId = id;
      return Promise.resolve({ success: true, data: {} });
    });

    await collect(chatViaTurn(provider, params({ toolExecutor })));

    expect(capturedId).toBe('call_from_api');
  });
});
