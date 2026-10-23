import { memoryStorage, MemoryStore } from '@chatcops/core';
import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChatHandler, describeBudgets } from '../src/handler.js';

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

describe('rate limits on the storage counters', () => {
  it('holds a limit across handlers that share the storage, and says when to retry', async () => {
    const storage = memoryStorage();
    const make = () =>
      createChatHandler({
        provider: scriptedProvider(Array.from({ length: 5 }, () => textStep('ok'))),
        systemPrompt: 'x',
        storage,
        rateLimit: { maxRequests: 2, windowMs: 60_000 },
      });
    const a = make();
    const b = make();

    expect((await chunks(a.handleChat({ conversationId: 'c1', message: 'one' }, '1.2.3.4'))).at(-1)).toEqual({ done: true });
    expect((await chunks(b.handleChat({ conversationId: 'c2', message: 'two' }, '1.2.3.4'))).at(-1)).toEqual({ done: true });
    const third = await chunks(a.handleChat({ conversationId: 'c3', message: 'three' }, '1.2.3.4'));

    expect(third).toEqual([{ error: 'rate_limit', retryAfter: expect.any(Number) }]);
    expect((third[0] as { retryAfter: number }).retryAfter).toBeGreaterThanOrEqual(1);
    expect((third[0] as { retryAfter: number }).retryAfter).toBeLessThanOrEqual(60);
    // Another visitor isn't affected.
    expect((await chunks(b.handleChat({ conversationId: 'c4', message: 'hi' }, '5.6.7.8'))).at(-1)).toEqual({ done: true });
  });

  it('still refuses a limit of zero', () => {
    expect(() => createChatHandler({ provider: scriptedProvider([]), systemPrompt: 'x', rateLimit: { maxRequests: 0, windowMs: 1000 } })).toThrow(
      'maxRequests must be greater than 0'
    );
  });
});

describe('budgets', () => {
  it('ends a reply with an error once the conversation budget is used up, without calling the model', async () => {
    const storage = memoryStorage();
    const provider = scriptedProvider([textStep('first', { usage: { inputTokens: 900, outputTokens: 200 } }), textStep('never')]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'x', storage, budgets: { perConversation: { tokens: 1000 } } });

    expect((await chunks(handleChat({ conversationId: 'c1', message: 'one' }))).at(-1)).toEqual({ done: true });
    expect(await chunks(handleChat({ conversationId: 'c1', message: 'two' }))).toEqual([{ error: 'provider_error' }]);
    cleanup();

    expect(provider.calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith('[chatcops] The conversation budget is used up, so a reply was refused.');
  });
});

describe('default budgets', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('caps a conversation at 200 replies when no budgets are set', async () => {
    const storage = memoryStorage();
    await storage.counters?.increment('budget:c:c1:messages', 200, 30 * DAY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = scriptedProvider([textStep('never')]);
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'x', storage });

    expect(await chunks(handleChat({ conversationId: 'c1', message: 'one more' }))).toEqual([{ error: 'provider_error' }]);
    cleanup();
    expect(provider.calls).toHaveLength(0);
  });

  it('caps tokens per IP per day by default', async () => {
    const storage = memoryStorage();
    const day = Math.floor(Date.now() / DAY);
    await storage.counters?.increment(`budget:ip:1.2.3.4:${day}:tokens`, 2_000_000, 2 * DAY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = scriptedProvider([textStep('Hi.')]);
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'x', storage });

    expect(await chunks(handleChat({ conversationId: 'c1', message: 'Hello' }, '1.2.3.4'))).toEqual([{ error: 'provider_error' }]);
    expect((await chunks(handleChat({ conversationId: 'c2', message: 'Hello' }, '5.6.7.8'))).at(-1)).toEqual({ done: true });
    cleanup();
  });

  it('turns off with budgets: false', async () => {
    const storage = memoryStorage();
    await storage.counters?.increment('budget:c:c1:messages', 200, 30 * DAY);
    const { handleChat, cleanup } = createChatHandler({ provider: scriptedProvider([textStep('Hi.')]), systemPrompt: 'x', storage, budgets: false });
    expect((await chunks(handleChat({ conversationId: 'c1', message: 'Hello' }))).at(-1)).toEqual({ done: true });
    cleanup();
  });

  it('logs the budgets in force once at startup', async () => {
    vi.resetModules();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { createChatHandler: fresh } = await import('../src/handler.js');
    fresh({ provider: scriptedProvider([]), systemPrompt: 'x' }).cleanup();
    fresh({ provider: scriptedProvider([]), systemPrompt: 'x' }).cleanup();
    expect(info.mock.calls).toEqual([
      [
        '[chatcops] Budgets: 200 replies per conversation (default), 2M tokens per IP per day (default). No daily total is set; `budgets.globalPerDay` caps your whole bill. Set `budgets` to change them, or `budgets: false` to turn them off.',
      ],
    ]);
  });

  it("doesn't log when budgets are off", async () => {
    vi.resetModules();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { createChatHandler: fresh } = await import('../src/handler.js');
    fresh({ provider: scriptedProvider([]), systemPrompt: 'x', budgets: false }).cleanup();
    expect(info).not.toHaveBeenCalled();
  });

  it('describes budgets you set', () => {
    expect(describeBudgets({ perConversation: { tokens: 400_000, messages: 50 }, perIpPerDay: false, globalPerDay: { usd: 20 } })).toBe(
      '[chatcops] Budgets: 400k tokens and 50 replies per conversation, $20 per day in total. Set `budgets` to change them, or `budgets: false` to turn them off.'
    );
  });
});

describe('pre-chat answers', () => {
  const lastUserText = (provider: ReturnType<typeof scriptedProvider>, call: number) =>
    provider.calls[call].messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';

  it('keeps them from the first message, and later requests cannot change them', async () => {
    const storage = memoryStorage();
    const provider = scriptedProvider([textStep('Hi Ada.'), textStep('Sure.')]);
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'x', storage });

    await chunks(handleChat({ conversationId: 'c1', message: 'Hello', userData: { name: 'Ada' } }));
    await chunks(handleChat({ conversationId: 'c1', message: 'Again', userData: { name: 'Mallory' } }));
    cleanup();

    expect((await storage.conversations.get('c1'))?.metadata).toEqual({ visitor: { name: 'Ada' } });
    expect(lastUserText(provider, 1)).toContain('name: Ada');
    expect(lastUserText(provider, 1)).not.toContain('Mallory');
  });

  it('uses the stored answers when the widget stops sending them', async () => {
    const provider = scriptedProvider([textStep('Hi.'), textStep('Yes.')]);
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'x', storage: memoryStorage() });
    await chunks(handleChat({ conversationId: 'c1', message: 'Hello', userData: { company: 'Acme' } }));
    await chunks(handleChat({ conversationId: 'c1', message: 'Next' }));
    cleanup();
    expect(lastUserText(provider, 1)).toContain('company: Acme');
  });

  it('keeps only the fields the server lists', async () => {
    const storage = memoryStorage();
    const provider = scriptedProvider([textStep('Hi.')]);
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'x', storage, preChatFields: ['name'] });
    await chunks(handleChat({ conversationId: 'c1', message: 'Hello', userData: { name: 'Ada', isAdmin: 'true' } }));
    cleanup();

    expect((await storage.conversations.get('c1'))?.metadata).toEqual({ visitor: { name: 'Ada' } });
    expect(lastUserText(provider, 0)).not.toContain('isAdmin');
  });
});
