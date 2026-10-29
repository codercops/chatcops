# @chatcops/store-redis

## 0.2.0

### Patch Changes

- Updated dependencies [897f8e3]
- Updated dependencies [bd6f3c8]
- Updated dependencies [304f1df]
- Updated dependencies [3ee5fdc]
- Updated dependencies [b0bd38d]
- Updated dependencies [4e86624]
- Updated dependencies [a714a12]
- Updated dependencies [8d6223d]
- Updated dependencies [f535508]
- Updated dependencies [e22060d]
- Updated dependencies [9d36629]
- Updated dependencies [d890cbe]
- Updated dependencies [100475b]
- Updated dependencies [7ecd228]
- Updated dependencies [b66fd9f]
- Updated dependencies [86085c0]
- Updated dependencies [a029c43]
  - @chatcops/core@0.6.0

## 0.1.0

### Minor Changes

- 5bd99f4: Add Redis storage adapter (`@chatcops/store-redis`) supporting `@upstash/redis` and `ioredis`.

  - Implements `conversations` with atomic version-checked appends, in-place message updates, removals, listing, and purging using Redis hashes, lists, sorted sets, and Lua scripts.
  - Implements `counters` with atomic increments and expiry initialization for rate limits.
  - Implements `kv` with JSON serialization and `setIfAbsent` (`NX`) for distributed locks.
  - Implements `events` with hourly count hashes for analytics event recording and time-bucketed queries.
  - Exposes `redisStorage`, `fromIoRedis`, and the minimal `RedisLike` interface.

### Patch Changes

- Updated dependencies [79fea7e]
- Updated dependencies [955809f]
- Updated dependencies [b138ded]
- Updated dependencies [e1e5e79]
- Updated dependencies [c2963af]
- Updated dependencies [0d666f2]
- Updated dependencies [c34a8d4]
- Updated dependencies [d320b44]
- Updated dependencies [1ca06e1]
- Updated dependencies [47ed5f1]
- Updated dependencies [aa3bb33]
- Updated dependencies [e8795ca]
- Updated dependencies [fd80586]
- Updated dependencies [049c52c]
- Updated dependencies [0578d5c]
- Updated dependencies [8e3e79e]
- Updated dependencies [1c76cf8]
- Updated dependencies [639a50c]
- Updated dependencies [6d80bc9]
- Updated dependencies [238eaef]
- Updated dependencies [332e588]
- Updated dependencies [be2ad74]
- Updated dependencies [ad1d9db]
- Updated dependencies [96372c8]
- Updated dependencies [f930e9c]
- Updated dependencies [3dd7dc8]
- Updated dependencies [545963f]
  - @chatcops/core@0.5.0
