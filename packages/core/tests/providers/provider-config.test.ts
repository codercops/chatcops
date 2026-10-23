import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider, normalizeHistory } from '../../src/providers/base.js';
import {
  ClaudeProvider,
  claudeRejectsTemperature,
  claudeSupportsEffort,
  parseClaudeModel,
} from '../../src/providers/claude.js';
import { OpenAIProvider, isOpenAIReasoningModel } from '../../src/providers/openai.js';
import { GeminiProvider } from '../../src/providers/gemini.js';
import { ConversationManager } from '../../src/conversation/manager.js';
import type { ChatMessage, ProviderChatParams } from '../../src/types.js';

function msg(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, role, content, timestamp: 0 };
}

async function collect(stream: AsyncGenerator<string>) {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function params(overrides?: Partial<ProviderChatParams>): ProviderChatParams {
  return { messages: [msg('u1', 'user', 'Hello')], systemPrompt: 'Be brief.', ...overrides };
}

const lookupTool = {
  name: 'lookup_order',
  description: 'Look up an order by ID',
  parameters: { orderId: { type: 'string' as const, description: 'Order ID' } },
  required: ['orderId'],
};

function claudeStream(finalMessage: Record<string, unknown>, texts: string[] = []) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of texts) yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
    },
    finalMessage: vi.fn().mockResolvedValue({ usage: { output_tokens: 1 }, ...finalMessage }),
  };
}

function mockClaude(provider: ClaudeProvider, stream: ReturnType<typeof vi.fn>) {
  (provider as unknown as { client: { messages: { stream: typeof stream } } }).client.messages.stream = stream;
}

function openAIStream(...chunks: unknown[]) {
  return { async *[Symbol.asyncIterator]() { for (const chunk of chunks) yield chunk; } };
}

function mockOpenAI(provider: OpenAIProvider, create: ReturnType<typeof vi.fn>) {
  (provider as unknown as { client: { chat: { completions: { create: typeof create } } } })
    .client.chat.completions.create = create;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('provider setup validation', () => {
  it.each(['claude', 'openai', 'gemini'] as const)('requires an explicit key for %s', async (type) => {
    vi.stubEnv('OPENAI_API_KEY', 'environment-key');
    vi.stubEnv('ANTHROPIC_API_KEY', 'environment-key');
    vi.stubEnv('GOOGLE_API_KEY', 'environment-key');
    try {
      for (const apiKey of [undefined, '', '   ']) {
        await expect(createProvider({ type, apiKey })).rejects.toThrow(`${type} requires apiKey`);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('validates keys when hosted classes are constructed directly', () => {
    expect(() => new ClaudeProvider({ type: 'claude' })).toThrow('claude requires apiKey');
    expect(() => new OpenAIProvider({ type: 'openai' })).toThrow('openai requires apiKey');
    expect(() => new GeminiProvider({ type: 'gemini' })).toThrow('gemini requires apiKey');
  });

  it.each(['baseURL', 'model'] as const)('requires a nonempty %s for openai-compatible', async (field) => {
    for (const value of [undefined, '', '   ']) {
      await expect(createProvider({
        type: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'local', [field]: value,
      })).rejects.toThrow(`openai-compatible requires ${field}`);
    }
  });

  it.each(['claude', 'openai', 'gemini'] as const)('keeps hosted defaults for %s', async (type) => {
    const provider = await createProvider({ type, apiKey: 'test-key' });
    expect(provider.name).toBe(type);
    expect(provider.model).toBe(type === 'claude' ? 'claude-haiku-5-5' : type === 'openai' ? 'gpt-5-mini' : 'gemini-3.5-flash-lite');
  });
});

describe('normalizeHistory', () => {
  it('drops system, empty and leading assistant turns', () => {
    expect(normalizeHistory([
      msg('s', 'system', 'rules'),
      msg('a0', 'assistant', 'left over from trimming'),
      msg('u1', 'user', 'Hi'),
      msg('a1', 'assistant', '   '),
      msg('a2', 'assistant', 'Hello!'),
    ])).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
    ]);
  });

  it('merges consecutive turns with the same role', () => {
    expect(normalizeHistory([
      msg('u1', 'user', 'First try'),
      msg('u2', 'user', 'Second try after a failed reply'),
      msg('a1', 'assistant', 'Answer'),
    ])).toEqual([
      { role: 'user', content: 'First try\n\nSecond try after a failed reply' },
      { role: 'assistant', content: 'Answer' },
    ]);
  });

  it('does not mutate the stored messages', () => {
    const stored = [msg('u1', 'user', 'a'), msg('u2', 'user', 'b')];
    normalizeHistory(stored);
    expect(stored.map((m) => m.content)).toEqual(['a', 'b']);
  });
});

describe('ConversationManager trimming', () => {
  it('never keeps an assistant turn first after trimming', async () => {
    const manager = new ConversationManager({ maxMessages: 4 });
    const sequence: Array<[ChatMessage['role'], string]> = [
      ['user', 'u1'], ['assistant', 'a1'], ['user', 'u2'], ['assistant', 'a2'], ['user', 'u3'],
    ];
    for (const [role, content] of sequence) {
      await manager.addMessage('c1', msg(content, role, content));
    }

    const messages = await manager.getMessages('c1');
    expect(messages[0].role).toBe('user');
    expect(messages.map((m) => m.content)).toEqual(['u2', 'a2', 'u3']);
  });
});

describe('Claude model capabilities', () => {
  it('parses family and version, ignoring date suffixes', () => {
    expect(parseClaudeModel('claude-haiku-5-5')).toEqual({ family: 'haiku', major: 5, minor: 5 });
    expect(parseClaudeModel('claude-haiku-4-5-20251001')).toEqual({ family: 'haiku', major: 4, minor: 5 });
    expect(parseClaudeModel('claude-opus-4-20250514')).toEqual({ family: 'opus', major: 4, minor: 0 });
    expect(parseClaudeModel('gpt-5-mini')).toBeNull();
  });

  it('knows which models take effort and which reject temperature', () => {
    expect(claudeSupportsEffort('claude-haiku-5-5')).toBe(true);
    expect(claudeSupportsEffort('claude-sonnet-4-6')).toBe(true);
    expect(claudeSupportsEffort('claude-opus-4-5')).toBe(true);
    expect(claudeSupportsEffort('claude-haiku-4-5')).toBe(false);
    expect(claudeRejectsTemperature('claude-haiku-5-5')).toBe(true);
    expect(claudeRejectsTemperature('claude-opus-4-7')).toBe(true);
    expect(claudeRejectsTemperature('claude-sonnet-4-6')).toBe(false);
    expect(claudeRejectsTemperature('claude-haiku-4-5')).toBe(false);
  });
});

describe('ClaudeProvider', () => {
  it('defaults to claude-haiku-5-5 with low effort and drops temperature with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new ClaudeProvider({ type: 'claude', apiKey: 'k' });
    const stream = vi.fn().mockImplementation(() => claudeStream(
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] },
      ['Hi'],
    ));
    mockClaude(provider, stream);

    await collect(provider.chat(params({ temperature: 0.4 })));
    await collect(provider.chat(params({ temperature: 0.4 })));

    const request = stream.mock.calls[0][0];
    expect(request.model).toBe('claude-haiku-5-5');
    expect(request.max_tokens).toBe(4096);
    expect(request.output_config).toEqual({ effort: 'low' });
    expect(request).not.toHaveProperty('temperature');
    expect(warn.mock.calls.filter(([text]) => String(text).includes('temperature'))).toHaveLength(1);
  });

  it('keeps temperature and sends no effort on models without it', async () => {
    const provider = new ClaudeProvider({ type: 'claude', apiKey: 'k', model: 'claude-haiku-4-5' });
    const stream = vi.fn().mockReturnValue(claudeStream({ stop_reason: 'end_turn', content: [] }));
    mockClaude(provider, stream);

    await collect(provider.chat(params({ temperature: 0.4 })));

    const request = stream.mock.calls[0][0];
    expect(request.temperature).toBe(0.4);
    expect(request).not.toHaveProperty('output_config');
  });

  it('passes a configured effort and baseURL through', async () => {
    const provider = new ClaudeProvider({
      type: 'claude', apiKey: 'k', effort: 'high', baseURL: 'https://proxy.example.com',
    });
    const stream = vi.fn().mockReturnValue(claudeStream({ stop_reason: 'end_turn', content: [] }));
    mockClaude(provider, stream);

    await collect(provider.chat(params()));

    expect(stream.mock.calls[0][0].output_config).toEqual({ effort: 'high' });
    expect((provider as unknown as { client: { baseURL: string } }).client.baseURL).toBe('https://proxy.example.com');
  });

  it('sends thinking blocks back unchanged on the next tool round', async () => {
    const provider = new ClaudeProvider({ type: 'claude', apiKey: 'k' });
    const stream = vi.fn()
      .mockReturnValueOnce(claudeStream({
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: 'Need the order.', signature: 'sig-1' },
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'tool_use', id: 'toolu_1', name: 'lookup_order', input: { orderId: '7' } },
        ],
      }))
      .mockReturnValueOnce(claudeStream({ stop_reason: 'end_turn', content: [] }, ['Shipped.']));
    mockClaude(provider, stream);

    const toolExecutor = vi.fn().mockResolvedValue({ success: true, data: { status: 'shipped' } });
    await collect(provider.chat(params({ tools: [lookupTool], toolExecutor })));

    const assistantTurn = stream.mock.calls[1][0].messages.at(-2);
    expect(assistantTurn).toEqual({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Need the order.', signature: 'sig-1' },
        { type: 'redacted_thinking', data: 'opaque' },
        { type: 'tool_use', id: 'toolu_1', name: 'lookup_order', input: { orderId: '7' } },
      ],
    });
  });

  it('throws on a refusal so the server reports a provider error', async () => {
    const provider = new ClaudeProvider({ type: 'claude', apiKey: 'k' });
    mockClaude(provider, vi.fn().mockReturnValue(claudeStream({ stop_reason: 'refusal', content: [] })));

    await expect(collect(provider.chat(params()))).rejects.toThrow('refusal');
  });

  it('normalizes history before sending it', async () => {
    const provider = new ClaudeProvider({ type: 'claude', apiKey: 'k' });
    const stream = vi.fn().mockReturnValue(claudeStream({ stop_reason: 'end_turn', content: [] }));
    mockClaude(provider, stream);

    await collect(provider.chat(params({
      messages: [msg('a0', 'assistant', 'orphan'), msg('u1', 'user', 'one'), msg('u2', 'user', 'two')],
    })));

    expect(stream.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'one\n\ntwo' }]);
  });
});

describe('OpenAI model capabilities', () => {
  it('treats o-series and GPT-5+ as reasoning models, except behind a custom baseURL', () => {
    expect(isOpenAIReasoningModel('gpt-5-mini')).toBe(true);
    expect(isOpenAIReasoningModel('o4-mini')).toBe(true);
    expect(isOpenAIReasoningModel('gpt-4o-mini')).toBe(false);
    expect(isOpenAIReasoningModel('gpt-5.2-chat-latest')).toBe(false);
    expect(isOpenAIReasoningModel('gpt-5-mini', 'http://localhost:11434/v1')).toBe(false);
  });
});

describe('OpenAIProvider', () => {
  it('defaults to gpt-5-mini with max_completion_tokens and low reasoning effort', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new OpenAIProvider({ type: 'openai', apiKey: 'k' });
    const create = vi.fn().mockResolvedValue(openAIStream({ choices: [{ delta: { content: 'Hi' }, finish_reason: 'stop' }] }));
    mockOpenAI(provider, create);

    await collect(provider.chat(params({ temperature: 0.3 })));

    const request = create.mock.calls[0][0];
    expect(request.model).toBe('gpt-5-mini');
    expect(request.max_completion_tokens).toBe(4096);
    expect(request).not.toHaveProperty('max_tokens');
    expect(request.reasoning_effort).toBe('low');
    expect(request).not.toHaveProperty('temperature');
    expect(request.stream).toBe(true);
  });

  it('supports OpenAI-compatible servers: baseURL, max_tokens and temperature', async () => {
    const provider = new OpenAIProvider({
      type: 'openai',
      apiKey: 'ollama',
      model: 'llama3.3',
      baseURL: 'http://localhost:11434/v1',
      organization: 'org_1',
      maxTokensParam: 'max_tokens',
    });
    const create = vi.fn().mockResolvedValue(openAIStream({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    mockOpenAI(provider, create);

    await collect(provider.chat(params({ maxTokens: 256, temperature: 0.3 })));

    const request = create.mock.calls[0][0];
    expect(request.max_tokens).toBe(256);
    expect(request).not.toHaveProperty('max_completion_tokens');
    expect(request.temperature).toBe(0.3);
    expect(request).not.toHaveProperty('reasoning_effort');
    const client = (provider as unknown as { client: { baseURL: string; organization: string } }).client;
    expect(client.baseURL).toBe('http://localhost:11434/v1');
    expect(client.organization).toBe('org_1');
  });

  it('runs tool calls in parallel and keeps the results in call order', async () => {
    const provider = new OpenAIProvider({ type: 'openai', apiKey: 'k' });
    const create = vi.fn()
      .mockResolvedValueOnce(openAIStream(
        {
          choices: [{
            delta: {
              tool_calls: [
                { index: 0, id: 'call_a', type: 'function', function: { name: 'lookup_order', arguments: '{"orderId":"1"}' } },
                { index: 1, id: 'call_b', type: 'function', function: { name: 'lookup_order', arguments: '{"orderId":"2"}' } },
              ],
            },
          }],
        },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      ))
      .mockResolvedValueOnce(openAIStream({ choices: [{ delta: { content: 'Both found.' }, finish_reason: 'stop' }] }));
    mockOpenAI(provider, create);

    let running = 0;
    let maxRunning = 0;
    const toolExecutor = vi.fn().mockImplementation(async (call: { input: { orderId: string } }) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, call.input.orderId === '1' ? 20 : 5));
      running -= 1;
      return { success: true, data: { orderId: call.input.orderId } };
    });

    const chunks = await collect(provider.chat(params({ tools: [lookupTool], toolExecutor })));

    expect(chunks).toEqual(['Both found.']);
    expect(maxRunning).toBe(2);
    const toolMessages = create.mock.calls[1][0].messages.filter((m: { role: string }) => m.role === 'tool');
    expect(toolMessages.map((m: { tool_call_id: string }) => m.tool_call_id)).toEqual(['call_a', 'call_b']);
  });
});

describe('abort signal', () => {
  it('Claude passes the signal to the SDK and skips the call when already aborted', async () => {
    const provider = new ClaudeProvider({ type: 'claude', apiKey: 'k' });
    const stream = vi.fn().mockReturnValue(claudeStream({ stop_reason: 'end_turn', content: [] }));
    mockClaude(provider, stream);
    const controller = new AbortController();

    await collect(provider.chat(params({ signal: controller.signal })));
    expect(stream.mock.calls[0][1]).toEqual({ signal: controller.signal });

    controller.abort();
    await expect(collect(provider.chat(params({ signal: controller.signal })))).rejects.toThrow();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('Claude stops before the next tool round once aborted', async () => {
    const provider = new ClaudeProvider({ type: 'claude', apiKey: 'k' });
    const controller = new AbortController();
    const stream = vi.fn().mockReturnValue(claudeStream({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'lookup_order', input: { orderId: '1' } }],
    }));
    mockClaude(provider, stream);
    const toolExecutor = vi.fn().mockImplementation(async () => {
      controller.abort();
      return { success: true };
    });

    await expect(collect(provider.chat(params({ tools: [lookupTool], toolExecutor, signal: controller.signal })))).rejects.toThrow();
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('OpenAI passes the signal to the SDK', async () => {
    const provider = new OpenAIProvider({ type: 'openai', apiKey: 'k' });
    const create = vi.fn().mockResolvedValue(openAIStream({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    mockOpenAI(provider, create);
    const controller = new AbortController();

    await collect(provider.chat(params({ signal: controller.signal })));
    expect(create.mock.calls[0][1]).toEqual({ signal: controller.signal });
  });
});
