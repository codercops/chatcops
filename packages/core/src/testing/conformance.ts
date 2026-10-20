import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isConflictError } from '../storage/errors.js';
import type { ChatCopsStorage } from '../storage/types.js';
import type { ChatMessage, Conversation } from '../types.js';

export interface StorageConformanceOptions {
  /**
   * TTL used by the expiry checks, in ms. The checks wait about twice this.
   * Default 150. Raise it for stores that round expiry to seconds.
   */
  ttlMs?: number;
  /**
   * Checks to leave out, for backends that can't meet them in a test run. For
   * example Workers KV has a 60 second minimum TTL, so `'kv-ttl'`.
   */
  skip?: Array<'kv-ttl' | 'counter-ttl' | 'conversation-concurrency' | 'counter-concurrency'>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let sequence = 0;
/** Ids unique to this run, so a shared database needs no cleanup between tests. */
function uniqueId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2, 8)}`;
}

function message(id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, content, timestamp: 1_700_000_000_000, ...extra };
}

/**
 * The behavior every ChatCops store must have. Call it from a test file with a
 * factory for your storage:
 *
 * ```ts
 * import { runStorageConformance } from '@chatcops/core/testing';
 * runStorageConformance('redis', () => redisStorage({ redis }));
 * ```
 *
 * Optional capabilities (`counters`, `kv`, `events`, `list`, `purge`,
 * `setIfAbsent`, `query`) are checked only when the storage has them.
 * `conversations.append`, `updateMessage` and `removeMessage` are required
 * here: a store without them only gets the 0.4 behavior.
 */
export function runStorageConformance(
  name: string,
  factory: () => ChatCopsStorage | Promise<ChatCopsStorage>,
  options: StorageConformanceOptions = {}
): void {
  const ttlMs = options.ttlMs ?? 150;
  const skip = new Set(options.skip ?? []);

  describe(`storage conformance: ${name}`, () => {
    let storage: ChatCopsStorage;

    beforeAll(async () => {
      storage = await factory();
    });

    afterAll(async () => {
      await storage?.close?.();
    });

    describe('conversations', () => {
      it('returns null for a conversation that does not exist', async () => {
        expect(await storage.conversations.get(uniqueId('missing'))).toBeNull();
      });

      it('creates a conversation on the first append and keeps messages in order', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('order');
        const first = await store.append(id, [message('u1', 'user', 'Hello')]);
        const second = await store.append(id, [message('a1', 'assistant', 'Hi'), message('u2', 'user', 'Prices?')]);
        expect(first.version).toBe(1);
        expect(second.version).toBe(2);

        const conversation = await store.get(id);
        expect(conversation?.id).toBe(id);
        expect(conversation?.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
        expect(conversation?.version).toBe(2);
        expect(conversation?.createdAt).toEqual(expect.any(Number));
        expect(conversation?.updatedAt).toBeGreaterThanOrEqual(conversation?.createdAt ?? 0);
      });

      it('round trips every message field', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('fields');
        const assistant = message('a1', 'assistant', 'Saved. ', {
          parts: [
            { type: 'reasoning', text: 'think', providerMetadata: { claude: { signature: 'sig==' } } },
            { type: 'text', text: 'Saved. ' },
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              toolName: 'capture_lead',
              input: { email: 'a@b.co', tags: ['x', 'y'], nested: { n: 1 } },
              executor: 'server',
              state: 'done',
            },
            { type: 'tool-result', toolCallId: 'call_1', toolName: 'capture_lead', output: { success: true } },
          ],
          status: 'complete',
          usage: { inputTokens: 120, outputTokens: 30, cacheReadTokens: 100 },
          aiGenerated: true,
          metadata: { model: 'm', unicode: 'Grüße 你好 🙂' },
        });
        await store.append(id, [message('u1', 'user', 'Line one\nline two'), assistant]);

        const conversation = await store.get(id);
        expect(conversation?.messages[0]).toEqual(message('u1', 'user', 'Line one\nline two'));
        expect(conversation?.messages[1]).toEqual(assistant);
      });

      it('rejects an append with a stale expectedVersion and writes nothing', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('conflict');
        await store.append(id, [message('u1', 'user', 'Hello')], { expectedVersion: 0 });

        const error = await store
          .append(id, [message('u2', 'user', 'Again')], { expectedVersion: 0 })
          .catch((err: unknown) => err);
        expect(isConflictError(error)).toBe(true);

        const conversation = await store.get(id);
        expect(conversation?.messages.map((m) => m.id)).toEqual(['u1']);
        expect(conversation?.version).toBe(1);
      });

      it('rejects expectedVersion above 0 for a conversation that does not exist', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('conflict-new');
        const error = await store.append(id, [message('u1', 'user', 'Hi')], { expectedVersion: 3 }).catch((e: unknown) => e);
        expect(isConflictError(error)).toBe(true);
        expect(await store.get(id)).toBeNull();
      });

      it('merges metadata on append', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('metadata');
        await store.append(id, [message('u1', 'user', 'Hi')], { metadata: { siteId: 's1', a: 1 } });
        await store.append(id, [message('u2', 'user', 'Hi again')], { metadata: { a: 2, b: 'x' } });
        expect((await store.get(id))?.metadata).toEqual({ siteId: 's1', a: 2, b: 'x' });
      });

      it.skipIf(skip.has('conversation-concurrency'))('loses no message under concurrent appends', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('concurrent');
        await Promise.all(
          Array.from({ length: 20 }, (_, i) => store.append(id, [message(`m${i}`, 'user', `#${i}`)]))
        );
        const conversation = await store.get(id);
        expect(conversation?.messages).toHaveLength(20);
        expect(new Set(conversation?.messages.map((m) => m.id)).size).toBe(20);
        expect(conversation?.version).toBe(20);
      });

      it.skipIf(skip.has('conversation-concurrency'))(
        'lets exactly one of several appends with the same expectedVersion through',
        async () => {
          const store = requireAppend(storage);
          const id = uniqueId('race');
          await store.append(id, [message('u0', 'user', 'start')]);
          const results = await Promise.allSettled(
            Array.from({ length: 8 }, (_, i) => store.append(id, [message(`r${i}`, 'user', 'x')], { expectedVersion: 1 }))
          );
          expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
          for (const result of results) {
            if (result.status === 'rejected') expect(isConflictError(result.reason)).toBe(true);
          }
          expect((await store.get(id))?.messages).toHaveLength(2);
        }
      );

      it('replaces a message in place with updateMessage', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('update');
        await store.append(id, [message('u1', 'user', 'Hi'), message('a1', 'assistant', 'Hel'), message('u2', 'user', 'More')]);
        const updated = message('a1', 'assistant', 'Hello there', { status: 'complete', parts: [{ type: 'text', text: 'Hello there' }] });

        expect(await store.updateMessage(id, updated)).toBe(true);
        const conversation = await store.get(id);
        expect(conversation?.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
        expect(conversation?.messages[1]).toEqual(updated);
        expect(conversation?.version).toBe(2);

        expect(await store.updateMessage(id, message('nope', 'assistant', 'x'))).toBe(false);
        expect(await store.updateMessage(uniqueId('missing'), updated)).toBe(false);
      });

      it('removes a message with removeMessage', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('remove');
        await store.append(id, [message('u1', 'user', 'Hi'), message('a1', 'assistant', 'Hello')]);
        expect(await store.removeMessage(id, 'a1')).toBe(true);
        expect((await store.get(id))?.messages.map((m) => m.id)).toEqual(['u1']);
        expect(await store.removeMessage(id, 'a1')).toBe(false);
      });

      it('hands out copies, so changing a result does not change the store', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('copy');
        await store.append(id, [message('u1', 'user', 'Hi')]);
        const first = await store.get(id);
        first?.messages.push(message('x', 'user', 'sneaky'));
        if (first?.messages[0]) first.messages[0].content = 'changed';
        expect((await store.get(id))?.messages).toEqual([message('u1', 'user', 'Hi')]);
      });

      it('still supports the 0.4 save() and get() round trip', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('legacy');
        const conversation: Conversation = {
          id,
          messages: [message('u1', 'user', 'Hi'), message('a1', 'assistant', 'Hello')],
          metadata: { from: 'save' },
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        };
        await store.save(conversation);
        const loaded = await store.get(id);
        expect(loaded?.messages).toEqual(conversation.messages);
        expect(loaded?.metadata).toEqual({ from: 'save' });
        expect(loaded?.createdAt).toBe(conversation.createdAt);

        const { version } = await store.append(id, [message('u2', 'user', 'After save')]);
        expect(version).toBe((loaded?.version ?? 0) + 1);
        expect((await store.get(id))?.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
      });

      it('deletes a conversation and its messages', async () => {
        const store = requireAppend(storage);
        const id = uniqueId('delete');
        await store.append(id, [message('u1', 'user', 'Hi')]);
        await store.delete(id);
        expect(await store.get(id)).toBeNull();
        expect((await store.append(id, [message('u2', 'user', 'New')])).version).toBe(1);
      });

      it('lists conversations, most recently updated first, across pages', async (ctx) => {
        if (!storage.conversations.list) return ctx.skip();
        const ids = [uniqueId('list'), uniqueId('list'), uniqueId('list')];
        for (const id of ids) {
          await requireAppend(storage).append(id, [message('u1', 'user', 'Hi')]);
          await sleep(5);
        }
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await storage.conversations.list({ limit: 2, cursor });
          expect(page.items.length).toBeLessThanOrEqual(2);
          seen.push(...page.items.map((item) => item.id));
          cursor = page.cursor;
        } while (cursor);

        const ours = seen.filter((id) => ids.includes(id));
        expect(ours).toEqual([...ids].reverse());
        expect(new Set(seen).size).toBe(seen.length);
      });

      it('purges conversations last updated before a time', async (ctx) => {
        if (!storage.conversations.purge) return ctx.skip();
        const store = requireAppend(storage);
        const old = uniqueId('purge-old');
        await store.append(old, [message('u1', 'user', 'old')]);
        await sleep(50);
        const cutoff = Date.now();
        await sleep(50);
        const recent = uniqueId('purge-new');
        await store.append(recent, [message('u1', 'user', 'new')]);

        expect(await storage.conversations.purge(cutoff)).toBeGreaterThanOrEqual(1);
        expect(await store.get(old)).toBeNull();
        expect(await store.get(recent)).not.toBeNull();
      });
    });

    describe('counters', () => {
      it('starts at the increment and keeps its expiry', async (ctx) => {
        const counters = storage.counters;
        if (!counters) return ctx.skip();
        const key = uniqueId('counter');
        const before = Date.now();
        const first = await counters.increment(key, 1, 60_000);
        expect(first.value).toBe(1);
        expect(first.expiresAt).toBeGreaterThanOrEqual(before + 59_000);
        expect(first.expiresAt).toBeLessThanOrEqual(Date.now() + 61_000);

        const second = await counters.increment(key, 5, 60_000);
        expect(second.value).toBe(6);
        expect(second.expiresAt).toBe(first.expiresAt);
        expect(await counters.get(key)).toEqual(second);
        expect(await counters.get(uniqueId('counter-missing'))).toBeNull();
      });

      it.skipIf(skip.has('counter-concurrency'))('counts every concurrent increment exactly once', async (ctx) => {
        const counters = storage.counters;
        if (!counters) return ctx.skip();
        const key = uniqueId('counter-race');
        const results = await Promise.all(Array.from({ length: 50 }, () => counters.increment(key, 1, 60_000)));
        expect(results.map((r) => r.value).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
        expect((await counters.get(key))?.value).toBe(50);
      });

      it.skipIf(skip.has('counter-ttl'))('starts again after it expires', async (ctx) => {
        const counters = storage.counters;
        if (!counters) return ctx.skip();
        const key = uniqueId('counter-ttl');
        await counters.increment(key, 3, ttlMs);
        await sleep(ttlMs * 2 + 50);
        expect(await counters.get(key)).toBeNull();
        expect((await counters.increment(key, 1, ttlMs)).value).toBe(1);
      });
    });

    describe('key-value', () => {
      it('sets, overwrites and deletes JSON values', async (ctx) => {
        const kv = storage.kv;
        if (!kv) return ctx.skip();
        const key = uniqueId('kv');
        expect(await kv.get(key)).toBeNull();
        await kv.set(key, { a: 1, list: [1, 'two'], nested: { ok: true } });
        expect(await kv.get(key)).toEqual({ a: 1, list: [1, 'two'], nested: { ok: true } });
        await kv.set(key, 'replaced');
        expect(await kv.get(key)).toBe('replaced');
        await kv.delete(key);
        expect(await kv.get(key)).toBeNull();
      });

      it('sets only when absent with setIfAbsent', async (ctx) => {
        const kv = storage.kv;
        if (!kv?.setIfAbsent) return ctx.skip();
        const key = uniqueId('kv-nx');
        expect(await kv.setIfAbsent(key, 'first')).toBe(true);
        expect(await kv.setIfAbsent(key, 'second')).toBe(false);
        expect(await kv.get(key)).toBe('first');
      });

      it('lets only one concurrent setIfAbsent win', async (ctx) => {
        const kv = storage.kv;
        if (!kv?.setIfAbsent) return ctx.skip();
        const key = uniqueId('kv-nx-race');
        const results = await Promise.all(Array.from({ length: 10 }, (_, i) => kv.setIfAbsent?.(key, i)));
        expect(results.filter(Boolean)).toHaveLength(1);
      });

      it.skipIf(skip.has('kv-ttl'))('expires values with a TTL', async (ctx) => {
        const kv = storage.kv;
        if (!kv) return ctx.skip();
        const key = uniqueId('kv-ttl');
        await kv.set(key, 'short', { ttlMs });
        expect(await kv.get(key)).toBe('short');
        await sleep(ttlMs * 2 + 50);
        expect(await kv.get(key)).toBeNull();
        if (kv.setIfAbsent) expect(await kv.setIfAbsent(key, 'again', { ttlMs })).toBe(true);
      });
    });

    describe('events', () => {
      it('writes events and counts them by day', async (ctx) => {
        const events = storage.events;
        if (!events) return ctx.skip();
        const type = uniqueId('event');
        const day = Date.UTC(2026, 9, 20);
        await events.write([
          { type, timestamp: day + 1_000 },
          { type, timestamp: day + 2_000, data: { conversationId: 'c1' } },
          { type, timestamp: day + 25 * 60 * 60 * 1000 },
        ]);
        if (!events.query) return;
        const counts = await events.query({ type, from: day, to: day + 3 * 24 * 60 * 60 * 1000, groupBy: 'day' });
        expect(counts).toEqual([
          { bucket: day, type, count: 2 },
          { bucket: day + 24 * 60 * 60 * 1000, type, count: 1 },
        ]);
      });
    });
  });
}

function requireAppend(storage: ChatCopsStorage) {
  const store = storage.conversations;
  if (!store.append || !store.updateMessage || !store.removeMessage) {
    throw new Error(
      'conversations needs append, updateMessage and removeMessage to pass conformance. Wrap a 0.4 store with withAppend().'
    );
  }
  return store as typeof store & Required<Pick<typeof store, 'append' | 'updateMessage' | 'removeMessage'>>;
}
