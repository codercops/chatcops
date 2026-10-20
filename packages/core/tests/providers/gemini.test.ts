import { describe, it, expect, vi } from 'vitest';
import { toGeminiTools } from '../../src/providers/base.js';
import { GeminiProvider, geminiSupportsThinkingLevel } from '../../src/providers/gemini.js';
import type { ProviderChatParams, ToolDefinition } from '../../src/types.js';

type GenerateStream = ReturnType<typeof vi.fn>;

function streamOf(...chunks: unknown[]) {
  return (async function* () {
    for (const chunk of chunks) yield chunk;
  })();
}

function textChunk(text: string) {
  return { candidates: [{ content: { role: 'model', parts: [{ text }] } }] };
}

function mockModels(provider: GeminiProvider, generateContentStream: GenerateStream) {
  (provider as unknown as { ai: { models: { generateContentStream: GenerateStream } } })
    .ai.models.generateContentStream = generateContentStream;
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
    ...overrides,
  };
}

describe('Gemini provider helpers', () => {
  it('converts tools to functionDeclarations with a JSON Schema', () => {
    const tools: ToolDefinition[] = [{
      name: 'get_price',
      description: 'Get product price',
      parameters: {
        productId: { type: 'string', description: 'Product ID' },
        currency: { type: 'string', description: 'Currency', enum: ['USD', 'EUR'] },
      },
      required: ['productId'],
    }];

    const result = toGeminiTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].functionDeclarations).toHaveLength(1);

    const decl = result[0].functionDeclarations![0];
    expect(decl.name).toBe('get_price');
    expect(decl.parameters).toBeUndefined();
    expect(decl.parametersJsonSchema).toEqual({
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product ID' },
        currency: { type: 'string', description: 'Currency', enum: ['USD', 'EUR'] },
      },
      required: ['productId'],
    });
  });

  it('passes the abort signal in the request config', async () => {
    const provider = new GeminiProvider({ type: 'gemini', apiKey: 'test-key' });
    const generate = vi.fn().mockResolvedValue(streamOf(textChunk('Hi')));
    mockModels(provider, generate);
    const controller = new AbortController();

    await collect(provider.chat(params({ signal: controller.signal })));
    expect(generate.mock.calls[0][0].config.abortSignal).toBe(controller.signal);
  });

  it('only uses thinkingLevel on Gemini 3 and later', () => {
    expect(geminiSupportsThinkingLevel('gemini-3.5-flash-lite')).toBe(true);
    expect(geminiSupportsThinkingLevel('gemini-2.5-flash')).toBe(false);
    expect(geminiSupportsThinkingLevel('my-proxy-model')).toBe(false);
  });
});

describe('GeminiProvider', () => {
  it('sends the whole normalized history and the config in one stateless call', async () => {
    const provider = new GeminiProvider({ type: 'gemini', apiKey: 'test-key', effort: 'medium' });
    const generate = vi.fn().mockResolvedValue(streamOf(textChunk('Hi '), textChunk('there')));
    mockModels(provider, generate);

    const chunks = await collect(provider.chat(params({
      messages: [
        { id: 'a0', role: 'assistant', content: 'Trimmed leftover', timestamp: 0 },
        { id: 'u1', role: 'user', content: 'First', timestamp: 1 },
        { id: 'a1', role: 'assistant', content: 'Reply', timestamp: 2 },
        { id: 'u2', role: 'user', content: 'Second', timestamp: 3 },
      ],
      maxTokens: 500,
      temperature: 0.2,
    })));

    expect(chunks).toEqual(['Hi ', 'there']);
    const request = generate.mock.calls[0][0];
    expect(request.model).toBe('gemini-3.5-flash-lite');
    expect(request.contents).toEqual([
      { role: 'user', parts: [{ text: 'First' }] },
      { role: 'model', parts: [{ text: 'Reply' }] },
      { role: 'user', parts: [{ text: 'Second' }] },
    ]);
    expect(request.config).toMatchObject({
      systemInstruction: 'You are helpful.',
      maxOutputTokens: 500,
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
    });
  });

  it('skips thought summaries in the visible text', async () => {
    const provider = new GeminiProvider({ type: 'gemini', apiKey: 'test-key' });
    mockModels(provider, vi.fn().mockResolvedValue(streamOf(
      { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: 'Answer' }] } }] },
    )));

    expect(await collect(provider.chat(params()))).toEqual(['Answer']);
  });

  it('throws before calling the API when there is no user message', async () => {
    const provider = new GeminiProvider({ type: 'gemini', apiKey: 'test-key' });
    const generate = vi.fn();
    mockModels(provider, generate);

    await expect(collect(provider.chat(params({
      messages: [{ id: 'a0', role: 'assistant', content: 'Only me', timestamp: 0 }],
    })))).rejects.toThrow('no user message');
    expect(generate).not.toHaveBeenCalled();
  });

  it('returns function results with the call id and keeps the model parts (thought signatures)', async () => {
    const provider = new GeminiProvider({ type: 'gemini', apiKey: 'test-key' });
    const callPart = {
      functionCall: { id: 'fc_1', name: 'lookup_order', args: { orderId: '123' } },
      thoughtSignature: 'sig-abc',
    };
    const generate = vi.fn()
      .mockResolvedValueOnce(streamOf({ candidates: [{ content: { role: 'model', parts: [callPart] } }] }))
      .mockResolvedValueOnce(streamOf(textChunk('Order 123 is shipped.')));
    mockModels(provider, generate);

    const toolExecutor = vi.fn().mockResolvedValue({ success: true, data: { status: 'shipped' } });
    const chunks = await collect(provider.chat(params({
      toolExecutor,
      tools: [{
        name: 'lookup_order',
        description: 'Look up an order by ID',
        parameters: { orderId: { type: 'string', description: 'Order ID' } },
        required: ['orderId'],
      }],
    })));

    expect(chunks).toEqual(['Order 123 is shipped.']);
    expect(toolExecutor).toHaveBeenCalledWith({ id: 'fc_1', name: 'lookup_order', input: { orderId: '123' } });

    const secondContents = generate.mock.calls[1][0].contents;
    expect(secondContents.at(-2)).toEqual({ role: 'model', parts: [callPart] });
    expect(secondContents.at(-1)).toEqual({
      role: 'user',
      parts: [{
        functionResponse: {
          id: 'fc_1',
          name: 'lookup_order',
          response: { success: true, data: { status: 'shipped' } },
        },
      }],
    });
  });
});
