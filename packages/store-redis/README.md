# @chatcops/store-redis

Redis storage adapter for ChatCops supporting both `@upstash/redis` (HTTP / serverless) and `ioredis` (TCP / persistent connections).

Implements all four ChatCops storage interfaces:
- **conversations**: metadata in Redis hashes, messages as JSON lists, conversation IDs in a sorted set ordered by `updated_at`, with atomic version-checked appends, updates, removals, listing, and purging.
- **counters**: atomic increments with fixed TTL reset for rate limits and budgets.
- **kv**: JSON key-value store with `setIfAbsent` (`NX`) for distributed locking.
- **events**: analytics event collection and querying.

## Installation

```bash
npm install @chatcops/store-redis
```

For Upstash / serverless:
```bash
npm install @upstash/redis
```

For standalone Redis (Node.js runtime):
```bash
npm install ioredis
```

## Setup on Vercel

### 1. Using `@upstash/redis` (Recommended for Edge / Serverless)

The `@upstash/redis` client communicates over HTTP REST, making it ideal for Vercel Serverless and Edge Functions without persistent TCP connection limits:

```typescript
import { Redis } from '@upstash/redis';
import { redisStorage } from '@chatcops/store-redis';
import { chatcopsVercelHandler } from '@chatcops/server';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const storage = redisStorage({
  redis,
  prefix: 'chatcops', // default: 'chatcops'
  conversationTtlMs: 30 * 24 * 60 * 60 * 1000, // default: 30 days
});

export const POST = chatcopsVercelHandler({
  storage,
  provider: { type: 'openai', apiKey: process.env.OPENAI_API_KEY },
  systemPrompt: 'You are a helpful assistant.',
});
```

### 2. Using `ioredis` via `fromIoRedis` (Node.js Serverless Functions)

When connecting directly to a standard Redis instance (or Redis cluster / Valkey) in Vercel Node.js Serverless Functions:

```typescript
import RedisIo from 'ioredis';
import { fromIoRedis, redisStorage } from '@chatcops/store-redis';
import { chatcopsVercelHandler } from '@chatcops/server';

// Reuse connection across warm lambda invocations
const io = new RedisIo(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
});

const storage = redisStorage({
  redis: fromIoRedis(io),
  prefix: 'chatcops',
});

export const POST = chatcopsVercelHandler({
  storage,
  provider: { type: 'openai', apiKey: process.env.OPENAI_API_KEY },
  systemPrompt: 'You are a helpful assistant.',
});
```

## Options

`redisStorage({ redis, prefix, conversationTtlMs })`

- `redis`: Either a `@upstash/redis` client instance or an adapter created with `fromIoRedis(ioClient)`.
- `prefix` (optional, default `'chatcops'`): Key prefix applied to all Redis keys for multi-tenant and environment isolation.
- `conversationTtlMs` (optional, default 30 days): TTL applied to conversation keys (`PEXPIRE`).

## Events Architecture: Hourly Count Hashes

Analytics events are stored using **hourly count hashes** rather than capped streams (`XADD`).

- **Why hourly count hashes over streams**: Redis Streams enforce strictly increasing entry IDs, which causes failures when events arrive out-of-order or with client timestamps in the past. Additionally, querying event counts aggregated by hour or day from a stream requires scanning and parsing historical stream logs client-side.
- **Hourly count hashes**: Events are bucketed by UTC hour (`{<prefix>}:events:<hour>`) and tracked in a sorted set index (`{<prefix>}:events:hours`). Each hash stores counts keyed by event type (`HINCRBY`). Queries efficiently read only the active hour buckets within the query window and aggregate into hourly or daily totals directly.
- **Hour-rounding query semantics**: Because events are pre-aggregated into 1-hour UTC buckets, queries round `from` down to the start of its UTC hour (`Math.floor(from / HOUR_MS) * HOUR_MS`) and `to` up to the end of its UTC hour (`Math.ceil(to / HOUR_MS) * HOUR_MS`), ensuring partial-hour queries accurately select all overlapping hourly buckets.

## Redis Cluster Compatibility

All keys generated for a given prefix share the `{<prefix>}` hash tag (e.g. `{chatcops}:conversations`, `{chatcops}:conv:<id>:meta`, `{chatcops}:events:hours`), ensuring all keys for that prefix reside in the same Redis Cluster hash slot while preserving isolation between prefixes. Every script-accessed key is explicitly passed through the `KEYS` array.
