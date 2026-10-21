---
"@chatcops/server": minor
---

New `allowedOrigins` option: the sites whose pages can use the chat, as exact origins or subdomain wildcards (`'https://*.acme.com'`). A browser request from any other page gets 403 `origin_not_allowed` before the model is called, with CORS headers so the page can read why. Responses echo the matched origin with `Vary: Origin`. Requests without an `Origin` header still pass. The default is still any origin (`['*']`).

`cors` is deprecated and read as a one-item `allowedOrigins`, with one warning. Setting both is an error. One change for `cors` users: a request without an `Origin` header no longer gets `Access-Control-Allow-Origin` back, which only browsers read, and browsers always send `Origin` on cross-origin requests.
