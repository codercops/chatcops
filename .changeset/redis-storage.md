---
"@chatcops/store-redis": minor
---

Add Redis storage adapter (`@chatcops/store-redis`) supporting `@upstash/redis` and `ioredis`.

- Implements `conversations` with atomic version-checked appends, in-place message updates, removals, listing, and purging using Redis hashes, lists, sorted sets, and Lua scripts.
- Implements `counters` with atomic increments and expiry initialization for rate limits.
- Implements `kv` with JSON serialization and `setIfAbsent` (`NX`) for distributed locks.
- Implements `events` with hourly count hashes for analytics event recording and time-bucketed queries.
- Exposes `redisStorage`, `fromIoRedis`, and the minimal `RedisLike` interface.
