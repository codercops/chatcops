---
"@chatcops/server": minor
---

The visitor's IP, which rate limits and the per-IP budget key on, is only read from headers a platform sets itself.

- `chatcopsVercelHandler` reads Vercel's headers only when it runs on Vercel. Elsewhere it no longer trusts the first `X-Forwarded-For` entry, which a visitor can set to get a fresh limit with every request. Set the new `clientIp` option to read your host's header (Netlify's `x-nf-client-connection-ip`, or one your proxy sets). Until then per-IP limits are skipped, with one warning.
- `chatcopsCloudflareHandler` reads `CF-Connecting-IP`, and also takes `clientIp`.
- Express keeps `req.ip`, and warns once when requests carry `X-Forwarded-For` while `trust proxy` is off.
- A request without a known IP skips per-IP limits instead of sharing one `"unknown"` limit with every other such visitor.
