import { afterAll, describe, expect, it } from 'vitest';
import { CloudflareConversations } from '../src/conversations.js';
import {
  ChatCopsCounter,
  SCHEMA_VERSION,
  cloudflareStorage,
  initializeSchema,
} from '../src/index.js';
import type { D1Database, DurableObjectState } from '../src/types.js';
import { disposeMiniflare, getMiniflareBindings } from './miniflare.js';

describe('cloudflare storage options and edge cases', () => {
  it('throws when d1 is not provided', () => {
    expect(() => cloudflareStorage({} as unknown as Parameters<typeof cloudflareStorage>[0])).toThrow(
      'cloudflareStorage requires a D1 database'
    );
  });

  it('throws on unsupported schema version', async () => {
    const { d1 } = await getMiniflareBindings();
    await initializeSchema(d1);

    await d1
      .prepare('INSERT OR REPLACE INTO chatcops_meta (key, value) VALUES (?, ?)')
      .bind('schema_version', String(SCHEMA_VERSION + 1))
      .run();

    await expect(initializeSchema(d1)).rejects.toThrow('Unsupported ChatCops SQLite schema version');

    // restore version
    await d1
      .prepare('INSERT OR REPLACE INTO chatcops_meta (key, value) VALUES (?, ?)')
      .bind('schema_version', String(SCHEMA_VERSION))
      .run();
  });

  it('throws on invalid list cursor', async () => {
    const { d1 } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1 });
    await expect(storage.conversations.list?.({ limit: 10, cursor: 'invalid' })).rejects.toThrow(
      'Not a list cursor'
    );
  });

  it('handles empty events array without errors', async () => {
    const { d1 } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1 });
    await expect(storage.events?.write([])).resolves.toBeUndefined();
  });

  it('queries events by hour and with type filter', async () => {
    const { d1 } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1 });
    const now = Date.now();
    await storage.events?.write([
      { type: 'click', timestamp: now },
      { type: 'view', timestamp: now + 10 },
      { type: 'click', timestamp: now + 3600 * 1000 },
    ]);

    const byHourWithType = await storage.events?.query?.({
      from: now - 1000,
      to: now + 7200 * 1000,
      type: 'click',
      groupBy: 'hour',
    });
    expect(byHourWithType?.length).toBeGreaterThanOrEqual(1);

    const byDayAll = await storage.events?.query?.({
      from: now - 1000,
      to: now + 7200 * 1000,
      groupBy: 'day',
    });
    expect(byDayAll?.length).toBeGreaterThanOrEqual(1);
  });

  it('calls close without error', async () => {
    const { d1 } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1 });
    await expect(storage.close?.()).resolves.toBeUndefined();
  });

  it('supports KV set without ttl and KV delete', async () => {
    const { kv } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1: (await getMiniflareBindings()).d1, kv });
    await storage.kv?.set('no-ttl', { foo: 'bar' });
    expect(await storage.kv?.get('no-ttl')).toEqual({ foo: 'bar' });
    await storage.kv?.delete('no-ttl');
    expect(await storage.kv?.get('no-ttl')).toBeNull();
  });

  it('supports ChatCopsCounter direct unit calls with mock storage', async () => {
    const store = new Map<string, unknown>();
    let scheduledAlarm: number | undefined;
    const mockState = {
      id: { toString: () => 'id1', equals: () => true },
      storage: {
        get: async (key: string) => store.get(key),
        put: async (key: string, val: unknown) => store.set(key, val),
        setAlarm: async (time: number | Date) => {
          scheduledAlarm = typeof time === 'number' ? time : time.getTime();
        },
        deleteAll: async () => store.clear(),
        delete: async () => true,
        list: async () => store,
      },
      waitUntil: () => {},
    };

    const counter = new ChatCopsCounter(mockState as unknown as DurableObjectState, {});

    expect(await counter.get()).toBeNull();

    const first = await counter.increment(1, 60_000);
    expect(first.value).toBe(1);
    expect(scheduledAlarm).toBe(first.expiresAt);

    const second = await counter.increment(3, 60_000);
    expect(second.value).toBe(4);
    expect(await counter.get()).toEqual(second);

    // Alarm execution cleans storage
    await counter.alarm();
    expect(store.size).toBe(0);
    expect(await counter.get()).toBeNull();

    // Expired counter reset creates a new alarm
    const reset = await counter.increment(2, 60_000);
    expect(reset.value).toBe(2);
    expect(scheduledAlarm).toBe(reset.expiresAt);
  });

  it('propagates non-unique-constraint D1 errors from batch during append', async () => {
    const d1Error = new Error('D1_ERROR: disk I/O failure');
    const fakeD1: D1Database = {
      prepare: () => ({
        bind: () => fakeD1.prepare(''),
        first: async () => null,
        run: async () => ({ results: [], success: true }),
        all: async () => ({ results: [], success: true }),
        raw: async () => [],
      }),
      batch: async () => {
        throw d1Error;
      },
      exec: async () => ({ count: 0, duration: 0 }),
    };

    const convs = new CloudflareConversations(fakeD1, Date.now, async () => {});

    const now = Date.now();
    await expect(
      convs.append('conv-fake-err', [{ id: 'm1', role: 'user', content: 'test', timestamp: now }], {
        expectedVersion: 0,
      })
    ).rejects.toThrow('D1_ERROR: disk I/O failure');

    await expect(
      convs.append('conv-fake-err', [{ id: 'm1', role: 'user', content: 'test', timestamp: now }])
    ).rejects.toThrow('D1_ERROR: disk I/O failure');
  });

  it('increments version atomically on save without extra select', async () => {
    const { d1 } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1 });
    const id = `atomic-save-${Date.now()}`;
    const now = Date.now();

    await storage.conversations.save({
      id,
      messages: [{ id: 'm1', role: 'user', content: 'hello', timestamp: now }],
      createdAt: now,
      updatedAt: now,
    });

    const first = await storage.conversations.get(id);
    expect(first?.version).toBe(1);

    await storage.conversations.save({
      id,
      messages: [
        { id: 'm1', role: 'user', content: 'hello', timestamp: now },
        { id: 'm2', role: 'assistant', content: 'world', timestamp: now + 5 },
      ],
      createdAt: now,
      updatedAt: now + 10,
    });

    const second = await storage.conversations.get(id);
    expect(second?.version).toBe(2);
    expect(second?.messages).toHaveLength(2);
  });

  it('purges conversations and relies on cascade to remove messages', async () => {
    const { d1 } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1 });
    const id = `purge-test-${Date.now()}`;
    const now = Date.now();

    await storage.conversations.save({
      id,
      messages: [{ id: 'm1', role: 'user', content: 'msg to be purged', timestamp: now }],
      createdAt: now,
      updatedAt: now,
    });

    const messagesBefore = await d1
      .prepare('SELECT count(*) as count FROM chatcops_messages WHERE conversation_id = ?')
      .bind(id)
      .first<{ count: number }>();
    expect(messagesBefore?.count).toBe(1);

    const purged = await storage.conversations.purge?.(now + 1000);
    expect(purged).toBeGreaterThanOrEqual(1);

    const convAfter = await storage.conversations.get(id);
    expect(convAfter).toBeNull();

    const messagesAfter = await d1
      .prepare('SELECT count(*) as count FROM chatcops_messages WHERE conversation_id = ?')
      .bind(id)
      .first<{ count: number }>();
    expect(messagesAfter?.count).toBe(0);
  });

  it('handles append with empty messages', async () => {
    const { d1 } = await getMiniflareBindings();
    const storage = cloudflareStorage({ d1 });
    const id = `empty-msg-${Date.now()}`;
    const res = await storage.conversations.append?.(id, [], { metadata: { tag: 'init' } });
    expect(res?.version).toBe(1);
    const conv = await storage.conversations.get(id);
    expect(conv?.version).toBe(1);
    expect(conv?.messages).toHaveLength(0);
    expect(conv?.metadata).toEqual({ tag: 'init' });
  });
});

afterAll(async () => {
  await disposeMiniflare();
});
