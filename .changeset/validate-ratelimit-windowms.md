---
"@chatcops/server": patch
---

Validate `rateLimit.windowMs` at startup in `createChatHandler`, rejecting values that are not finite numbers greater than 0.
