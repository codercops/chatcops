---
"@chatcops/core": minor
---

Add `toLegacyChunk(part)`, which turns a protocol v1 stream part into the chunk a widget before 0.6 reads (`{"content":"Hi"}`, `{"done":true}`, `{"error":"rate_limit","retryAfter":2}` and so on), or `null` for parts those widgets have no use for. The 0.6 server will use it to keep answering old widgets.
