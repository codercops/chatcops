---
"@chatcops/core": patch
---

`chat()` and `chatSync()` on `ClaudeProvider`, `OpenAIProvider` and `GeminiProvider` are marked `@deprecated` in their types, pointing to `runTurn()`. They behave as before.
