import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai.js';
import { ClaudeProvider } from '../../src/providers/claude.js';
import { GeminiProvider } from '../../src/providers/gemini.js';
import type { ProviderChatParams } from '../../src/types.js';

async function collect(stream: AsyncGenerator<string>) {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function createParams(overrides?: Partial<ProviderChatParams>): ProviderChatParams {
  return {
    messages: [{ id: '1', role: 'user', content: 'Check order 123', timestamp: Date.now() }],
    systemPrompt: 'You are helpful.',
    tools: [{
      name: 'lookup_order',
      description: 'Look up an order by ID',
      parameters: {
        orderId: { type: 'string', description: 'Order ID' },
      },
      required: ['orderId'],
    }],
    ...overrides,
  };
}

describe('provider tool execution loops', () => {
  it('OpenAIProvider continues streaming after a tool call', async () => {
    const provider = new OpenAIProvider({ type: 'openai', apiKey: 'test-key' });
    const create = vi.fn()
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call_1',
                  function: {
                    name: 'lookup_order',
                    arguments: '{"orderId":"123"}',
                  },
                }],
              },
            }],
          };
          yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
        },
      })
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'Order 123 is shipped.' } }] };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      });

    (provider as unknown as { client: { chat: { completions: { create: typeof create } } } }).client.chat.completions.create = create;

    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'shipped' },
      message: 'Order found',
    });

    const chunks = await collect(provider.chat(createParams({ toolExecutor })));

    expect(chunks).toEqual(['Order 123 is shipped.']);
    expect(toolExecutor).toHaveBeenCalledWith({
      id: 'call_1',
      name: 'lookup_order',
      input: { orderId: '123' },
    });

    const secondRequestMessages = create.mock.calls[1][0].messages;
    expect(secondRequestMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({ id: 'call_1' })],
      }),
      expect.objectContaining({
        role: 'tool',
        tool_call_id: 'call_1',
      }),
    ]));
  });

  it('OpenAIProvider converts malformed tool args into a tool failure instead of aborting', async () => {
    const provider = new OpenAIProvider({ type: 'openai', apiKey: 'test-key' });
    const create = vi.fn()
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{
              delta: {
                tool_calls: [{
                  index: 0,
                  id: 'call_bad',
                  function: {
                    name: 'lookup_order',
                    arguments: '{"orderId"',
                  },
                }],
              },
            }],
          };
          yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
        },
      })
      .mockResolvedValueOnce({
        async *[Symbol.asyncIterator]() {
          yield { choices: [{ delta: { content: 'I could not parse the tool input.' } }] };
          yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
        },
      });

    (provider as unknown as { client: { chat: { completions: { create: typeof create } } } }).client.chat.completions.create = create;

    const toolExecutor = vi.fn();
    const chunks = await collect(provider.chat(createParams({ toolExecutor })));

    expect(chunks).toEqual(['I could not parse the tool input.']);
    expect(toolExecutor).not.toHaveBeenCalled();

    const toolMessage = create.mock.calls[1][0].messages.find((message: { role: string }) => message.role === 'tool');
    expect(toolMessage.content).toContain('"success":false');
    expect(toolMessage.content).toContain('valid JSON');
  });

  it('OpenAIProvider chatSync loops through tool calls before returning text', async () => {
    const provider = new OpenAIProvider({ type: 'openai', apiKey: 'test-key' });
    const create = vi.fn()
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [{
              id: 'call_sync',
              type: 'function',
              function: {
                name: 'lookup_order',
                arguments: '{"orderId":"123"}',
              },
            }],
          },
        }],
      })
      .mockResolvedValueOnce({
        choices: [{
          finish_reason: 'stop',
          message: {
            content: 'Order 123 is shipped.',
          },
        }],
      });

    (provider as unknown as { client: { chat: { completions: { create: typeof create } } } }).client.chat.completions.create = create;

    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'shipped' },
    });

    const response = await provider.chatSync(createParams({ toolExecutor }));

    expect(response).toBe('Order 123 is shipped.');
    expect(toolExecutor).toHaveBeenCalledOnce();
  });

  it('ClaudeProvider resumes after tool_use blocks', async () => {
    const provider = new ClaudeProvider({ type: 'claude', apiKey: 'test-key' });
    const stream = vi.fn()
      .mockReturnValueOnce({
        async *[Symbol.asyncIterator]() {},
        finalMessage: vi.fn().mockResolvedValue({
          stop_reason: 'tool_use',
          content: [{
            type: 'tool_use',
            id: 'toolu_1',
            name: 'lookup_order',
            input: { orderId: '123' },
          }],
        }),
      })
      .mockReturnValueOnce({
        async *[Symbol.asyncIterator]() {
          yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Order 123 is shipped.' } };
        },
        finalMessage: vi.fn().mockResolvedValue({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Order 123 is shipped.' }],
        }),
      });

    (provider as unknown as { client: { messages: { stream: typeof stream } } }).client.messages.stream = stream;

    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'shipped' },
    });

    const chunks = await collect(provider.chat(createParams({ toolExecutor })));

    expect(chunks).toEqual(['Order 123 is shipped.']);
    expect(toolExecutor).toHaveBeenCalledWith({
      id: 'toolu_1',
      name: 'lookup_order',
      input: { orderId: '123' },
    });

    const secondMessages = stream.mock.calls[1][0].messages;
    expect(secondMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant' }),
      expect.objectContaining({ role: 'user' }),
    ]));
  });

  it('GeminiProvider sends function responses back into the chat session', async () => {
    const provider = new GeminiProvider({ type: 'gemini', apiKey: 'test-key' });
    const sendMessageStream = vi.fn()
      .mockResolvedValueOnce({
        stream: (async function* () {})(),
        response: Promise.resolve({
          functionCalls: () => [{ name: 'lookup_order', args: { orderId: '123' } }],
          text: () => '',
        }),
      })
      .mockResolvedValueOnce({
        stream: (async function* () {
          yield { text: () => 'Order 123 is shipped.' };
        })(),
        response: Promise.resolve({
          functionCalls: () => undefined,
          text: () => 'Order 123 is shipped.',
        }),
      });

    const startChat = vi.fn().mockReturnValue({ sendMessageStream });
    const getGenerativeModel = vi.fn().mockReturnValue({ startChat });
    (provider as unknown as { genAI: { getGenerativeModel: typeof getGenerativeModel } }).genAI.getGenerativeModel = getGenerativeModel;

    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'shipped' },
    });

    const chunks = await collect(provider.chat(createParams({ toolExecutor })));

    expect(chunks).toEqual(['Order 123 is shipped.']);
    expect(toolExecutor).toHaveBeenCalledOnce();

    const secondRequest = sendMessageStream.mock.calls[1][0];
    expect(secondRequest).toEqual([
      expect.objectContaining({
        functionResponse: {
          name: 'lookup_order',
          response: expect.objectContaining({ success: true }),
        },
      }),
    ]);
  });

  it('OpenAIProvider stops after the max tool-call iterations guard', async () => {
    const provider = new OpenAIProvider({ type: 'openai', apiKey: 'test-key' });
    const create = vi.fn().mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_loop',
                function: {
                  name: 'lookup_order',
                  arguments: '{"orderId":"123"}',
                },
              }],
            },
          }],
        };
        yield { choices: [{ delta: {}, finish_reason: 'tool_calls' }] };
      },
    }));

    (provider as unknown as { client: { chat: { completions: { create: typeof create } } } }).client.chat.completions.create = create;

    const toolExecutor = vi.fn().mockResolvedValue({
      success: true,
      data: { status: 'still-looping' },
    });

    await expect(collect(provider.chat(createParams({ toolExecutor })))).rejects.toThrow(
      'Exceeded maximum tool rounds (5).'
    );
    expect(toolExecutor).toHaveBeenCalledTimes(5);
  });
});
