---
'@chatcops/server': patch
---

Build the Cloudflare Worker handler once and reuse it, rather than rebuilding
it inside `fetch`. Rebuilding per request gave every request a fresh
conversation store and rate limiter, so the bot forgot earlier messages and
rate limiting never engaged. The handler is now created lazily on the first
request, because the API key is a Worker secret that only exists there.
