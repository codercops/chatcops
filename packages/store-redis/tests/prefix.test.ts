import type { ChatMessage } from '@chatcops/core';
import { Redis } from '@upstash/redis';
import RedisIo from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fromIoRedis, redisStorage } from '../src/index.js';
import type { RedisLike } from '../src/types.js';

const upstashUrl = process.env.CHATCOPS_TEST_UPSTASH_URL;
const upstashToken = process.env.CHATCOPS_TEST_UPSTASH_TOKEN;
const redisUrl = process.env.CHATCOPS_TEST_REDIS_URL;

function runPrefixSuite(
  clientName: string,
  createClient: () => { redis: RedisLike; cleanup: () => Promise<void> }
) {
  describe(`prefix isolation: ${clientName}`, () => {
    let redis: RedisLike;
    let cleanup: () => Promise<void>;

    beforeAll(() => {
      const res = createClient();
      redis = res.redis;
      cleanup = res.cleanup;
    });

    afterAll(async () => {
      await cleanup?.();
    });

    const msg = (id: string, text: string): ChatMessage => ({
      id,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    });

    it('isolates conversations across different prefixes', async () => {
      const p1 = `test-p1-${Date.now().toString(36)}`;
      const p2 = `test-p2-${Date.now().toString(36)}`;

      const s1 = redisStorage({ redis, prefix: p1 });
      const s2 = redisStorage({ redis, prefix: p2 });

      const convId = 'shared-conv-id';
      await s1.conversations.append?.(convId, [msg('m1', 'hello from s1')]);

      // s2 should not see s1's conversation
      expect(await s2.conversations.get(convId)).toBeNull();

      // append to s2 with the same conversation ID
      await s2.conversations.append?.(convId, [msg('m2', 'hello from s2')]);

      const c1 = await s1.conversations.get(convId);
      const c2 = await s2.conversations.get(convId);

      expect(c1?.messages[0].content).toBe('hello from s1');
      expect(c2?.messages[0].content).toBe('hello from s2');

      // List isolation
      const list1 = await s1.conversations.list?.({ limit: 10 });
      const list2 = await s2.conversations.list?.({ limit: 10 });
      expect(list1?.items.map((i) => i.id)).toEqual([convId]);
      expect(list2?.items.map((i) => i.id)).toEqual([convId]);

      // Purge isolation
      const purgeTime = Date.now() + 10_000;
      const purged1 = await s1.conversations.purge?.(purgeTime);
      expect(purged1).toBe(1);
      expect(await s1.conversations.get(convId)).toBeNull();
      // s2 should still have its conversation intact
      expect(await s2.conversations.get(convId)).not.toBeNull();

      // Clean up s2
      await s2.conversations.delete(convId);
      expect(await s2.conversations.get(convId)).toBeNull();
    });

    it('isolates counters across different prefixes', async () => {
      const p1 = `test-cnt1-${Date.now().toString(36)}`;
      const p2 = `test-cnt2-${Date.now().toString(36)}`;

      const s1 = redisStorage({ redis, prefix: p1 });
      const s2 = redisStorage({ redis, prefix: p2 });

      const key = 'limit';
      const c1 = await s1.counters?.increment(key, 10, 60_000);
      expect(c1?.value).toBe(10);

      expect(await s2.counters?.get(key)).toBeNull();

      const c2 = await s2.counters?.increment(key, 5, 60_000);
      expect(c2?.value).toBe(5);

      expect((await s1.counters?.get(key))?.value).toBe(10);
      expect((await s2.counters?.get(key))?.value).toBe(5);
    });

    it('isolates key-value store across different prefixes', async () => {
      const p1 = `test-kv1-${Date.now().toString(36)}`;
      const p2 = `test-kv2-${Date.now().toString(36)}`;

      const s1 = redisStorage({ redis, prefix: p1 });
      const s2 = redisStorage({ redis, prefix: p2 });

      const key = 'lock';
      await s1.kv?.set(key, { held: true });
      expect(await s2.kv?.get(key)).toBeNull();

      // setIfAbsent on s2 succeeds because s1's key is in another prefix
      expect(await s2.kv?.setIfAbsent?.(key, { heldByS2: true })).toBe(true);
      expect(await s1.kv?.get(key)).toEqual({ held: true });
      expect(await s2.kv?.get(key)).toEqual({ heldByS2: true });

      await s1.kv?.delete(key);
      expect(await s1.kv?.get(key)).toBeNull();
      expect(await s2.kv?.get(key)).toEqual({ heldByS2: true });

      await s2.kv?.delete(key);
    });

    it('isolates analytics events across different prefixes', async () => {
      const p1 = `test-ev1-${Date.now().toString(36)}`;
      const p2 = `test-ev2-${Date.now().toString(36)}`;

      const s1 = redisStorage({ redis, prefix: p1 });
      const s2 = redisStorage({ redis, prefix: p2 });

      const now = Date.now();
      await s1.events?.write([
        { type: 'test_event', timestamp: now },
        { type: 'test_event', timestamp: now + 10 },
      ]);

      const q1 = await s1.events?.query?.({
        type: 'test_event',
        from: now - 3600_000,
        to: now + 3600_000,
        groupBy: 'hour',
      });
      expect(q1).toHaveLength(1);
      expect(q1?.[0].count).toBe(2);

      const q2 = await s2.events?.query?.({
        type: 'test_event',
        from: now - 3600_000,
        to: now + 3600_000,
        groupBy: 'hour',
      });
      expect(q2).toEqual([]);
    });
  });
}

if (redisUrl) {
  runPrefixSuite('ioredis', () => {
    const io = new RedisIo(redisUrl, { maxRetriesPerRequest: 3 });
    return {
      redis: fromIoRedis(io),
      cleanup: async () => {
        await io.quit();
      },
    };
  });
} else {
  describe.skip('prefix isolation: ioredis (set CHATCOPS_TEST_REDIS_URL to run)', () => {});
}

if (upstashUrl && upstashToken) {
  runPrefixSuite('@upstash/redis', () => {
    const client = new Redis({ url: upstashUrl, token: upstashToken });
    return {
      redis: client,
      cleanup: async () => {},
    };
  });
} else {
  describe.skip('prefix isolation: @upstash/redis (set CHATCOPS_TEST_UPSTASH_URL and CHATCOPS_TEST_UPSTASH_TOKEN to run)', () => {});
}
