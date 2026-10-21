import { runStorageConformance } from '@chatcops/core/testing';
import { Redis } from '@upstash/redis';
import RedisIo from 'ioredis';
import { describe } from 'vitest';
import { fromIoRedis, redisStorage } from '../src/index.js';

const upstashUrl = process.env.CHATCOPS_TEST_UPSTASH_URL;
const upstashToken = process.env.CHATCOPS_TEST_UPSTASH_TOKEN;
const redisUrl = process.env.CHATCOPS_TEST_REDIS_URL;

if (upstashUrl && upstashToken) {
  runStorageConformance('@upstash/redis', () => {
    const client = new Redis({
      url: upstashUrl,
      token: upstashToken,
    });
    return redisStorage({ redis: client });
  });
} else {
  describe.skip('@upstash/redis conformance (set CHATCOPS_TEST_UPSTASH_URL and CHATCOPS_TEST_UPSTASH_TOKEN to run)', () => {});
}

if (redisUrl) {
  runStorageConformance('fromIoRedis', () => {
    const client = new RedisIo(redisUrl, { maxRetriesPerRequest: 3 });
    return redisStorage({ redis: fromIoRedis(client) });
  });
} else {
  describe.skip('fromIoRedis conformance (set CHATCOPS_TEST_REDIS_URL to run)', () => {});
}
