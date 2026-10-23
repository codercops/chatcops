---
"@chatcops/core": minor
---

Add `ClaudeProvider.step()`, which runs one model request and reports text, reasoning, tool calls, token usage and why the model stopped, without running tools. Stored messages with parts go back to Claude as native blocks, including thinking signatures. Also adds a `fetch` option to every provider config (for proxies, or replaying recorded responses in tests) and `normalizeTurns()`, which cleans up history like `normalizeHistory()` but keeps tool calls and their results. `estimateTokens()` now counts tool inputs and results on messages with parts.
