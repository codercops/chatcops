import type { ChatMessage, Conversation } from '@chatcops/core';
import RedisIo from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseJson } from '../src/adapter.js';
import { fromIoRedis, redisStorage } from '../src/index.js';
import type { RedisLike } from '../src/types.js';

const redisUrl = process.env.CHATCOPS_TEST_REDIS_URL;

describe('adapter and options edge cases', () => {
  it('throws TypeError if redis is missing in redisStorage', () => {
    // @ts-expect-error test invalid argument
    expect(() => redisStorage()).toThrow(TypeError);
    // @ts-expect-error test invalid argument
    expect(() => redisStorage({})).toThrow(TypeError);
  });

  it('throws TypeError if redis is missing in fromIoRedis', () => {
    // @ts-expect-error test invalid argument
    expect(() => fromIoRedis()).toThrow(TypeError);
    // @ts-expect-error test invalid argument
    expect(() => fromIoRedis(null)).toThrow(TypeError);
  });

  it('handles parseJson edge cases', () => {
    expect(parseJson(null)).toBeNull();
    expect(parseJson(undefined)).toBeNull();
    expect(parseJson('plain string')).toBe('plain string');
    expect(parseJson('{"valid":"json"}')).toEqual({ valid: 'json' });
    expect(parseJson({ already: 'object' })).toEqual({ already: 'object' });
    expect(parseJson(123)).toBe(123);
  });

  it('adapts ioredis methods and flags', async () => {
    const calls: { method: string; args: unknown[] }[] = [];
    const mockIo = {
      eval: async (script: string, numKeys: number, ...args: unknown[]) => {
        calls.push({ method: 'eval', args: [script, numKeys, ...args] });
        return 'eval-res';
      },
      get: async (key: string) => {
        calls.push({ method: 'get', args: [key] });
        return '{"parsed":true}';
      },
      set: async (...args: unknown[]) => {
        calls.push({ method: 'set', args });
        return 'OK';
      },
      del: async (...keys: string[]) => {
        calls.push({ method: 'del', args: keys });
        return keys.length;
      },
      quit: async () => {
        calls.push({ method: 'quit', args: [] });
      },
      disconnect: () => {
        calls.push({ method: 'disconnect', args: [] });
      },
    };

    const adapter = fromIoRedis(mockIo);

    // eval
    const evalRes = await adapter.eval('return 1', ['k1'], ['a1']);
    expect(evalRes).toBe('eval-res');
    expect(calls.find((c) => c.method === 'eval')?.args).toEqual(['return 1', 1, 'k1', 'a1']);

    // get
    const getRes = await adapter.get('test-key');
    expect(getRes).toEqual({ parsed: true });

    // set with EX and NX
    await adapter.set('k', 'v', { ex: 60, nx: true });
    expect(calls.find((c) => c.method === 'set')?.args).toEqual(['k', 'v', 'EX', 60, 'NX']);

    // set with non-string value
    await adapter.set('k2', { num: 1 }, { px: 1000 });
    expect(calls.filter((c) => c.method === 'set')[1].args).toEqual(['k2', '{"num":1}', 'PX', 1000]);

    // set with string value and no options
    await adapter.set('k3', 'simple');
    expect(calls.filter((c) => c.method === 'set')[2].args).toEqual(['k3', 'simple']);

    // del with no keys and multiple keys
    expect(await adapter.del()).toBe(0);
    expect(await adapter.del('k1', 'k2')).toBe(2);

    // close and disconnect
    await adapter.close?.();
    adapter.disconnect?.();
    expect(calls.some((c) => c.method === 'quit')).toBe(true);
    expect(calls.some((c) => c.method === 'disconnect')).toBe(true);
  });

  it('closes redis client in redisStorage.close', async () => {
    let closed = false;
    let disconnected = false;

    const mockRedis = {
      eval: async () => {},
      get: async () => null,
      set: async () => 'OK',
      del: async () => 1,
      close: async () => {
        closed = true;
      },
    };

    // @ts-expect-error test mock
    const s1 = redisStorage({ redis: mockRedis });
    await s1.close?.();
    expect(closed).toBe(true);

    const mockRedis2 = {
      eval: async () => {},
      get: async () => null,
      set: async () => 'OK',
      del: async () => 1,
      disconnect: () => {
        disconnected = true;
      },
    };

    // @ts-expect-error test mock
    const s2 = redisStorage({ redis: mockRedis2 });
    await s2.close?.();
    expect(disconnected).toBe(true);
  });
});

describe.runIf(Boolean(redisUrl))('store edge cases with real redis', () => {
  let io: RedisIo;
  let redis: RedisLike;

  beforeAll(() => {
    if (!redisUrl) throw new Error('CHATCOPS_TEST_REDIS_URL not set');
    io = new RedisIo(redisUrl, { maxRetriesPerRequest: 3 });
    redis = fromIoRedis(io);
  });

  afterAll(async () => {
    await io.quit();
  });

  const msg = (id: string, text: string): ChatMessage => ({
    id,
    role: 'user',
    content: text,
    timestamp: Date.now(),
  });

  it('handles events edge cases (empty write, query all types, sorting)', async () => {
    const prefix = `test-ev-edge-${Date.now().toString(36)}`;
    const storage = redisStorage({ redis, prefix });

    // Empty write
    await storage.events?.write([]);

    const baseTime = Date.UTC(2026, 9, 20, 10, 0, 0);
    await storage.events?.write([
      { type: 'type_b', timestamp: baseTime + 100 },
      { type: 'type_a', timestamp: baseTime + 200 },
      { type: 'type_a', timestamp: baseTime + 3600_000 + 100 },
    ]);

    // Query all types (no type filter)
    const counts = await storage.events?.query?.({
      from: baseTime,
      to: baseTime + 2 * 3600_000,
      groupBy: 'hour',
    });

    expect(counts).toEqual([
      { bucket: baseTime, type: 'type_a', count: 1 },
      { bucket: baseTime, type: 'type_b', count: 1 },
      { bucket: baseTime + 3600_000, type: 'type_a', count: 1 },
    ]);
  });

  it('handles conversations list edge cases (invalid cursor, updatedAfter, metadata)', async () => {
    const prefix = `test-conv-edge-${Date.now().toString(36)}`;
    const storage = redisStorage({ redis, prefix });

    const id1 = 'c1';
    const id2 = 'c2';
    await storage.conversations.append?.(id1, [msg('m1', 'hello')], {
      metadata: { key1: 'value1' },
    });
    await storage.conversations.append?.(id2, [msg('m2', 'world')]);

    // Save with no createdAt and no metadata
    const convNoMeta: Conversation = {
      id: 'c3',
      messages: [msg('m3', 'test')],
      createdAt: 0,
      updatedAt: 0,
    };
    await storage.conversations.save(convNoMeta);

    // List with invalid/unknown cursor should return empty
    const listBadCursor = await storage.conversations.list?.({
      limit: 10,
      cursor: 'invalid:cursor',
    });
    expect(listBadCursor?.items).toHaveLength(0);

    // List with updatedAfter in the future should return empty
    const listFuture = await storage.conversations.list?.({
      limit: 10,
      updatedAfter: Date.now() + 100_000,
    });
    expect(listFuture?.items).toHaveLength(0);

    // List all
    const all = await storage.conversations.list?.({ limit: 10 });
    expect(all?.items.length).toBeGreaterThanOrEqual(3);
    const withMeta = all?.items.find((i) => i.id === id1);
    expect(withMeta?.metadata).toEqual({ key1: 'value1' });

    // Purge when nothing is older than 0
    const purgedNone = await storage.conversations.purge?.(0);
    expect(purgedNone).toBe(0);

    // Legacy metadata format in Redis hash
    const legacyId = 'conv-legacy-hash';
    const legacyMetaKey = `{${prefix}}:conv:${legacyId}:meta`;
    const legacyMsgsKey = `{${prefix}}:conv:${legacyId}:messages`;
    const legacyZset = `{${prefix}}:conversations`;
    await redis.eval(
      `
      redis.call('HSET', KEYS[1], 'id', ARGV[1], 'version', 1, 'createdAt', ARGV[2], 'updatedAt', ARGV[2], 'metadata', '{"legacy":true}')
      redis.call('RPUSH', KEYS[2], '{"id":"m1","role":"user","content":"legacy"}')
      redis.call('ZADD', KEYS[3], ARGV[2], ARGV[1])
      return 1
      `,
      [legacyMetaKey, legacyMsgsKey, legacyZset],
      [legacyId, Date.now()]
    );

    const legacyLoaded = await storage.conversations.get(legacyId);
    expect(legacyLoaded?.metadata).toEqual({ legacy: true });

    const legacyListed = await storage.conversations.list?.({ limit: 10 });
    const legacyItem = legacyListed?.items.find((i) => i.id === legacyId);
    expect(legacyItem?.metadata).toEqual({ legacy: true });
  });

  it('handles kv raw string and non-envelope responses in get', async () => {
    let mockVal: unknown = '{"__cc_kv":1,"v":"from-raw-string"}';
    const mockRedis: RedisLike = {
      eval: (async () => 1) as RedisLike['eval'],
      get: (async () => mockVal) as RedisLike['get'],
      set: async () => 'OK',
      del: async () => 1,
    };

    const s = redisStorage({ redis: mockRedis });
    expect(await s.kv?.get('k')).toBe('from-raw-string');

    // Invalid JSON string
    mockVal = 'not-json{';
    expect(await s.kv?.get('k')).toBe('not-json{');

    // JSON string without envelope
    mockVal = '{"unwrapped":123}';
    expect(await s.kv?.get('k')).toEqual({ unwrapped: 123 });

    // Raw non-object
    mockVal = 42;
    expect(await s.kv?.get('k')).toBe(42);
  });

  it('formats slot prefix with and without existing braces', async () => {
    const { formatSlotPrefix } = await import('../src/adapter.js');
    expect(formatSlotPrefix('prefix')).toBe('{prefix}');
    expect(formatSlotPrefix('{prefix}')).toBe('{{prefix}}');
  });

  it('handles storage close with quit method', async () => {
    let quitCalled = false;
    const mockQuit: RedisLike = {
      eval: (async () => 1) as RedisLike['eval'],
      get: (async () => null) as RedisLike['get'],
      set: async () => 'OK',
      del: async () => 1,
      quit: async () => {
        quitCalled = true;
      },
    };
    const s = redisStorage({ redis: mockQuit });
    await s.close?.();
    expect(quitCalled).toBe(true);
  });
});
