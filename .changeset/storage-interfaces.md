---
"@chatcops/core": minor
---

Add the storage layer the next server release uses. Nothing uses it yet, so behavior doesn't change.

- `ConversationStore` gains optional `append` (atomic, with an `expectedVersion` check that throws `ConflictError`), `updateMessage`, `removeMessage`, `list` and `purge`. A store with only `get`, `save` and `delete` is still valid.
- New `CounterStore`, `KeyValueStore` and `EventSink` interfaces, grouped in `ChatCopsStorage`.
- `memoryStorage()` implements all of them in process, with a cap on conversations (least recently used go first), idle expiry, capped counters, keys and events, and no timers, so it's safe at global scope on Workers.
- `withAppend(store)` adds the new conversation methods to a 0.4 store, serializing writes per conversation within one process.
- `@chatcops/core/testing` exports `runStorageConformance(name, factory)`, the checks every store must pass, for store packages and custom stores. It needs `vitest`, an optional peer dependency.
