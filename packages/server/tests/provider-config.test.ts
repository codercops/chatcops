import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerProvider } from '@chatcops/core';
import { createChatHandler } from '../src/handler.js';

afterEach(() => vi.restoreAllMocks());

async function collect(stream: AsyncIterable<string>) {
  const chunks: unknown[] = [];
  for await (const chunk of stream) chunks.push(JSON.parse(chunk));
  return chunks;
}

describe('provider configuration through the server', () => {
  it('accepts a compatible provider without an API key and omits configured tools', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const execute = vi.fn();
    const bodies: Record<string, unknown>[] = [];
    const fetch: typeof globalThis.fetch = vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      expect(new Headers(init?.headers).get('X-Route')).toBe('server');
      return new Response('data: {"choices":[{"delta":{"content":"Local reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    });
    const handler = createChatHandler({
      provider: {
        type: 'openai-compatible', baseURL: 'http://localhost:11434/v1', model: 'server-local',
        supportsTools: false, headers: { 'X-Route': 'server' }, fetch,
      },
      tools: [{ name: 'lookup', description: 'Look up an order', parameters: {}, execute }],
      systemPrompt: 'Test', budgets: false,
    });
    try {
      for (const conversationId of ['local-1', 'local-2']) {
        const chunks = await collect(handler.handleChat({ conversationId, message: 'Hi' }));
        expect(chunks).toContainEqual({ content: 'Local reply' });
        expect(chunks).toContainEqual({ done: true });
      }
      expect(bodies).toHaveLength(2);
      expect(bodies.every((body) => !('tools' in body) && body.max_tokens === 4096)).toBe(true);
      expect(execute).not.toHaveBeenCalled();
      expect(warn.mock.calls.filter(([message]) => String(message).includes('supportsTools'))).toHaveLength(1);
    } finally {
      handler.cleanup();
    }
  });

  it('uses a registered provider without a key', async () => {
    registerProvider('server-custom', () => ({
      name: 'server-custom',
      async *chat() { yield 'Custom reply'; },
      async chatSync() { return 'Custom reply'; },
    }));
    const handler = createChatHandler({ provider: { type: 'server-custom' }, systemPrompt: 'Test', budgets: false });
    try {
      expect(await collect(handler.handleChat({ conversationId: 'custom', message: 'Hi' }))).toContainEqual({ content: 'Custom reply' });
    } finally {
      handler.cleanup();
    }
  });

  it.each(['claude', 'openai', 'gemini'])('reports a missing hosted %s key through existing setup-error handling', async (type) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = createChatHandler({ provider: { type }, systemPrompt: 'Test', budgets: false });
    try {
      expect(await collect(handler.handleChat({ conversationId: type, message: 'Hi' }))).toEqual([{ error: 'provider_error' }]);
      expect(error).toHaveBeenCalledExactlyOnceWith('[chatcops] Provider setup failed:', `${type} requires apiKey`);
    } finally {
      handler.cleanup();
    }
  });
});
