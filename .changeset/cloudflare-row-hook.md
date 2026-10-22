---
"@chatcops/store-cloudflare": minor
---

`extraColumns` and `rowHook` stamp columns you've added (a tenant or site id) on every new conversation and message row, as in the Postgres and SQLite stores. The `kv` option is gone: ChatCops only uses key-value storage for turn locks, which need the atomic `setIfAbsent` that Workers KV doesn't have, so turn locks always live in D1 and hold across isolates.
