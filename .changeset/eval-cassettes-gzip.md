---
"@chatcops/cli": patch
---

Eval recordings save response bodies over 4 kB gzipped in base64 (`encoding: 'gzip'`), so a streamed reply, which is one event per token, takes about a tenth of the space. Request bodies stay readable JSON, so a re-recording's diff still shows what changed.
