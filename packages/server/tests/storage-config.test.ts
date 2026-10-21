import { memoryStorage, MemoryStore } from '@chatcops/core';
import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatHandler } from '../src/handler.js';

async function chunks(stream: AsyncGenerator<string>) {
  const out: unknown[] = [];
  for await (const chunk of stream) out.push(JSON.parse(chunk));
  return out;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the storage option', () => {
  it('stores conversations in the given storage', async () => {
    const storage = memoryStorage();
    const { handleChat, cleanup } = createChatHandler({ provider: scriptedProvider([textStep('Hi.')]), systemPrompt: 'x', storage });
    await chunks(handleChat({ conversationId: 'c1', message: 'Hello' }));
    cleanup();
    expect((await storage.conversations.get('c1'))?.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('holds the one-reply-at-a-time lock across handlers that share the storage', async () => {
    const storage = memoryStorage();
    const a = createChatHandler({ provider: scriptedProvider(['hang']), systemPrompt: 'x', storage });
    const b = createChatHandler({ provider: scriptedProvider([textStep('Hi.')]), systemPrompt: 'x', storage });
    const controller = new AbortController();

    const first = chunks(a.handleChat({ conversationId: 'c1', message: 'one' }, undefined, { signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Another instance answering the same conversation is turned away.
    expect(await chunks(b.handleChat({ conversationId: 'c1', message: 'two' }))).toEqual([{ error: 'provider_error' }]);

    controller.abort();
    await first;
    a.cleanup();
    b.cleanup();
  });

  it('refuses storage and conversationStore together', () => {
    expect(() =>
      createChatHandler({ provider: scriptedProvider([]), systemPrompt: 'x', storage: memoryStorage(), conversationStore: new MemoryStore() })
    ).toThrow('Set `storage` or `conversationStore`, not both.');
  });

  it('warns once when a serverless deployment keeps conversations in memory', async () => {
    vi.resetModules();
    vi.stubEnv('VERCEL', '1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { createChatHandler: fresh } = await import('../src/handler.js');
    fresh({ provider: scriptedProvider([]), systemPrompt: 'x' }).cleanup();
    fresh({ provider: scriptedProvider([]), systemPrompt: 'x' }).cleanup();
    fresh({ provider: scriptedProvider([]), systemPrompt: 'x', storage: memoryStorage() }).cleanup();
    expect(warn.mock.calls.filter(([text]) => String(text).includes('No `storage` is set'))).toHaveLength(1);
  });

  it("doesn't warn on a long-running server", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { createChatHandler: fresh } = await import('../src/handler.js');
    fresh({ provider: scriptedProvider([]), systemPrompt: 'x' }).cleanup();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('purge', () => {
  it('deletes conversations older than the retention period', async () => {
    const storage = memoryStorage({ conversationTtlMs: 365 * 24 * 60 * 60 * 1000 });
    await storage.conversations.append?.('old', [{ id: 'u', role: 'user', content: 'x', timestamp: 0 }]);
    const { purge, cleanup } = createChatHandler({ provider: scriptedProvider([]), systemPrompt: 'x', storage, retention: { conversationsDays: 7 } });

    expect(await purge(Date.now() + 6 * 24 * 60 * 60 * 1000)).toBe(0);
    expect(await purge(Date.now() + 8 * 24 * 60 * 60 * 1000)).toBe(1);
    cleanup();
  });

  it('resolves null when the store has no purge', async () => {
    const conversationStore = { get: async () => null, save: async () => {}, delete: async () => {} };
    const { purge, cleanup } = createChatHandler({ provider: scriptedProvider([]), systemPrompt: 'x', conversationStore });
    expect(await purge()).toBeNull();
    cleanup();
  });
});
