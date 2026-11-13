---
"@chatcops/server": patch
---

Validate `rateLimit.maxRequests` and `rateLimit.windowMs` at startup in `createChatHandler`, rejecting values that are not finite numbers greater than 0.
