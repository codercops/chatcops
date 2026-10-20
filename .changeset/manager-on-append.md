---
"@chatcops/core": minor
"@chatcops/server": patch
---

Conversations are written with `append` instead of rewriting the whole conversation, so two server instances answering the same conversation no longer lose each other's messages, when the store supports it.

- `ConversationManager` takes `storage` (a `ChatCopsStorage`) as well as `store`, and defaults to `memoryStorage()`, which is bounded, instead of the unbounded `MemoryStore`.
- A store with only `get`, `save` and `delete` still works; the manager adds the other methods with `withAppend()` and logs one warning that concurrent writes from two instances can lose a message.
- A conversation is saved with its first message, not when it's first read.
- The history sent to the model is trimmed by an estimated token budget (32,000 by default, `maxHistoryTokens`), keeping the visitor's first message and the newest ones, instead of by message count. `trimHistory()` and `estimateTokens()` are exported. The stored cap (`maxMessages`, 100) still applies, now through atomic removes, and still never leaves an assistant turn first.
- New `appendMessages()` (with `expectedVersion`), `updateMessage()`, `getHistory()` and `acquireTurn()`, which keeps two replies from being generated for one conversation at once, across instances when the storage has `kv`.
