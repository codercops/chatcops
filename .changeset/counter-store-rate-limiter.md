---
"@chatcops/core": minor
---

Add `createRateLimiter` — a sliding-window rate limiter built on `CounterStore`.

- Uses two fixed-window counters to produce a smooth sliding estimate without per-request timestamps: `estimate = prev × (1 − elapsed/windowMs) + current`.
- Counts denied requests, so a hammering client stays limited.
- Returns `remaining` (never below 0) and `retryAfterMs` (clamped to `[1, windowMs]`) on every call.
- No timers or in-process state — safe at global scope on Cloudflare Workers and Vercel Edge.
- Exported from `@chatcops/core` as `createRateLimiter`, `RateLimitRule`, `RateLimitResult`, `RateLimiterOptions`.
