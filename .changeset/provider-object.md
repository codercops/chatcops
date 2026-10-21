---
"@chatcops/core": minor
"@chatcops/server": minor
---

The server's `provider` option also takes a provider object (anything with `step()` or `chat()`), for providers ChatCops doesn't ship and for tests with `scriptedProvider()`. Core exports `isAIProvider()` to tell the two apart.
