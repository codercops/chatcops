import type { ChatCopsStorage } from '@chatcops/core';
import { fromIoRedis } from './adapter.js';
import { RedisConversationStore } from './conversations.js';
import { RedisCounterStore } from './counters.js';
import { RedisEventSink } from './events.js';
import { RedisKeyValueStore } from './kv.js';
import type {
  IoRedisLike,
  RedisLike,
  RedisSetOptions,
  RedisStorageOptions,
} from './types.js';

export const DEFAULT_PREFIX = 'chatcops';
export const DEFAULT_CONVERSATION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function redisStorage(options: RedisStorageOptions): ChatCopsStorage {
  if (!options?.redis) {
    throw new TypeError('redisStorage requires a redis client');
  }

  const {
    redis,
    prefix = DEFAULT_PREFIX,
    conversationTtlMs = DEFAULT_CONVERSATION_TTL_MS,
  } = options;

  return {
    conversations: new RedisConversationStore(redis, prefix, conversationTtlMs),
    counters: new RedisCounterStore(redis, prefix),
    kv: new RedisKeyValueStore(redis, prefix),
    events: new RedisEventSink(redis, prefix),
    close: async () => {
      if (typeof redis.quit === 'function') {
        await redis.quit();
      } else if (typeof redis.close === 'function') {
        await redis.close();
      } else if (typeof redis.disconnect === 'function') {
        redis.disconnect();
      }
    },
  };
}

export {
  fromIoRedis,
  RedisConversationStore,
  RedisCounterStore,
  RedisKeyValueStore,
  RedisEventSink,
};

export type {
  RedisLike,
  IoRedisLike,
  RedisStorageOptions,
  RedisSetOptions,
};
