import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../../src/providers/base.js';
import type { ProviderChatParams, ProviderConfig } from '../../src/types.js';

const tool = { name: 'lookup', description: 'Look up an order', parameters: {} };
const params: ProviderChatParams = {
  messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: 0 }],
  systemPrompt: 'Be brief.',
  tools: [tool],
};

function response(toolCall = false) {
  const delta = toolCall
    ? { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }
    : { content: 'Hello' };
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: toolCall ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function transport(toolRound = false, rejectStreamOptions = false) {
  const requests: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  let round = 0;
  const fetch: typeof globalThis.fetch = vi.fn(async (url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({ url: String(url), headers: new Headers(init?.headers), body });
    if (rejectStreamOptions && body.stream_options) {
      return new Response(JSON.stringify({ error: { message: 'Unsupported stream_options' } }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }
    return response(toolRound && round++ === 0);
  });
  return { fetch, requests };
}

async function collect(stream: AsyncIterable<unknown>) {
  const values: unknown[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

afterEach(() => vi.restoreAllMocks());

describe('openai-compatible', () => {
  it('starts without a key and sends default headers and max_tokens on every entry point', async () => {
    const { fetch, requests } = transport();
    const provider = await createProvider({
      type: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'llama3.2', fetch,
      headers: { 'HTTP-Referer': 'https://acme.test', 'X-Route': 'local' },
    });

    expect(provider.name).toBe('openai-compatible');
    expect(provider.model).toBe('llama3.2');
    if (!provider.step) throw new Error('Expected a stepping provider');
    expect(await collect(provider.step(params))).toContainEqual({ type: 'text-delta', delta: 'Hello' });
    expect(await collect(provider.chat(params))).toEqual(['Hello']);
    expect(await provider.chatSync(params)).toBe('Hello');

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.url).toBe('http://localhost:11434/v1/chat/completions');
      expect(request.headers.get('HTTP-Referer')).toBe('https://acme.test');
      expect(request.headers.get('X-Route')).toBe('local');
      expect(request.headers.get('Authorization')).toBe('Bearer chatcops-local');
      expect(request.body).toMatchObject({ model: 'llama3.2', max_tokens: 4096, tools: [expect.any(Object)] });
      expect(request.body).not.toHaveProperty('max_completion_tokens');
      expect(request.body).not.toHaveProperty('reasoning_effort');
    }
  });

  it.each(['max_tokens', 'max_completion_tokens'] as const)('honors an explicit %s override and key', async (maxTokensParam) => {
    const { fetch, requests } = transport();
    const provider = await createProvider({
      type: 'openai-compatible', baseURL: 'https://proxy.test/v1', model: 'local',
      apiKey: 'test-key', maxTokensParam, fetch,
    });
    await provider.chatSync({ ...params, maxTokens: 128, temperature: 0.4 });
    expect(requests[0].body).toMatchObject({ [maxTokensParam]: 128, temperature: 0.4 });
    expect(requests[0].body).not.toHaveProperty(maxTokensParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens');
    expect(requests[0].headers.get('Authorization')).toBe('Bearer test-key');
  });

  it('omits tools and warns once across streaming, collected replies, retries and subsequent requests', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetch, requests } = transport(false, true);
    const config: ProviderConfig = {
      type: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'no-tools',
      supportsTools: false, headers: { 'X-Route': 'disabled' }, fetch,
    };
    const provider = await createProvider(config);
    // No configured tools means no tool warning.
    await provider.chatSync({ ...params, tools: [] });
    expect(warn.mock.calls.filter(([message]) => String(message).includes('supportsTools'))).toHaveLength(0);

    await collect(provider.chat(params));
    await provider.chatSync(params);
    if (!provider.step) throw new Error('Expected a stepping provider');
    await collect(provider.step(params));
    // warnOnce is process-wide, including another instance with the same model.
    await (await createProvider(config)).chatSync(params);

    expect(warn.mock.calls.filter(([message]) => String(message).includes('supportsTools'))).toHaveLength(1);
    expect(requests.length).toBeGreaterThan(5);
    for (const request of requests) {
      expect(request.body).not.toHaveProperty('tools');
      expect(request.body.max_tokens).toBe(4096);
      expect(request.headers.get('X-Route')).toBe('disabled');
    }
  });

  it.each(['chat', 'chatSync'] as const)('never adds tools on later %s rounds when disabled', async (method) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Even an endpoint that sends an unsolicited tool call must not make a later request advertise tools.
    const { fetch, requests } = transport(true);
    const provider = await createProvider({
      type: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: `disabled-round-${method}`,
      supportsTools: false, fetch,
    });
    const toolExecutor = vi.fn().mockResolvedValue({ success: true, message: 'Found' });
    const request = { ...params, toolExecutor };
    const text = method === 'chat' ? (await collect(provider.chat(request))).join('') : await provider.chatSync(request);
    expect(text).toBe('Hello');
    expect(requests).toHaveLength(2);
    expect(requests.every(({ body }) => !('tools' in body))).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
  });

  it.each([undefined, true])('keeps tools enabled (%s) and sends headers/token settings through tool rounds', async (supportsTools) => {
    const { fetch, requests } = transport(true);
    const provider = await createProvider({
      type: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'with-tools',
      supportsTools, headers: { 'X-Route': 'tools' }, fetch,
    });
    const execute = vi.fn().mockResolvedValue({ success: true, message: 'Found' });
    expect(await provider.chatSync({ ...params, toolExecutor: execute })).toBe('Hello');
    expect(execute).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.body.tools).toEqual([expect.objectContaining({ type: 'function' })]);
      expect(request.body.max_tokens).toBe(4096);
      expect(request.headers.get('X-Route')).toBe('tools');
    }
    expect(requests[1].body.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'call_1' }));
  });

  it('keeps hosted OpenAI request defaults and supports its explicit header/tool options', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fetch, requests } = transport();
    const provider = await createProvider({
      type: 'openai', apiKey: 'test-key', supportsTools: false, headers: { 'X-Route': 'hosted' }, fetch,
    });
    await provider.chatSync(params);
    expect(provider.name).toBe('openai');
    expect(requests[0].body).toMatchObject({ model: 'gpt-5-mini', max_completion_tokens: 4096, reasoning_effort: 'low' });
    expect(requests[0].body).not.toHaveProperty('max_tokens');
    expect(requests[0].body).not.toHaveProperty('tools');
    expect(requests[0].headers.get('X-Route')).toBe('hosted');
    expect(warn).toHaveBeenCalledOnce();
  });
});
