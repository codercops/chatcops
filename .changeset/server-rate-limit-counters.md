---
"@chatcops/server": minor
---

Rate limits now count on the storage's counters (`createRateLimiter` from core, a sliding window), so with a shared store a limit holds across every server instance instead of per process. The handler starts no timers anymore, so it can be created at global scope on Workers; `cleanup()` is kept but does nothing. The `RateLimiter` export is deprecated.
