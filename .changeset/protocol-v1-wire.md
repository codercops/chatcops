---
"@chatcops/server": minor
"@chatcops/core": minor
---

The server speaks protocol v1. A request with `"protocol": 1` in the body (what the 0.6 widget sends) or an `x-chatcops-protocol: 1` header gets typed parts (`start`, `text-delta`, `finish` and so on) and a response header `x-chatcops-protocol: 1`. Requests without it get exactly the 0.5 stream, and the server logs one line the first time it answers one.

In protocol v1, a request that can't be answered gets a real HTTP status with a JSON body and CORS headers: 400 `invalid_request`, 409 `conversation_busy`, 413 `payload_too_large` (bodies over 256 KB), 429 `rate_limited` with `Retry-After`, 503 `provider_unavailable`. Errors after the stream starts are an `error` part, then `finish`.

All three adapters now share one module for this, so they send the same headers (`Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, and no `Connection`, which HTTP/2 doesn't allow) and one `[DONE]`. When nothing has been sent for 10 seconds, as during a slow tool, they send a `: ping` comment so proxies and the widget don't close the connection. The CORS preflight allows the `Authorization` and `X-ChatCops-Protocol` headers.

New: `exposeUsage: true` adds token usage to the v1 `finish` part. `createChatHandler()` has `startChat()`, which resolves a refusal or the reply's v1 parts, for custom adapters, and `protocolStats()`, which counts requests in each format. `@chatcops/core/protocol` exports the protocol types and helpers on their own, for clients that don't need the rest of core.
