---
"@chatcops/server": minor
"@chatcops/widget": minor
"@chatcops/core": minor
---

Cloudflare Turnstile when a session is issued. With `turnstile: { secretKey }` on the server, `/session` checks a Turnstile token with Cloudflare before signing (401 `turnstile_failed` otherwise, 503 when Cloudflare can't be reached), and a refresh with the previous token skips it. The widget's `turnstileSiteKey` (`data-turnstile-site-key`) loads Cloudflare's script only when it first needs a session and renders the challenge in the page, outside the shadow root.
