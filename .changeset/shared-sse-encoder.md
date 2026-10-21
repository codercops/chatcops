---
"@chatcops/core": minor
---

Expose shared SSE utilities for streaming responses:

- `encodeSSE(part)`: encodes a `WirePart` or object into standard SSE framing (`data: <json>\n\n`).
- `SSE_PING`: comment frame (`: ping\n\n`) to keep connections alive without emitting events.
- `SSE_DONE`: terminal frame (`data: [DONE]\n\n`) signaling stream completion.
- `SSE_HEADERS`: immutable standard HTTP headers for SSE responses (`Content-Type`, `Cache-Control`, and `X-Accel-Buffering`, with `Connection` omitted for HTTP/2 compatibility).
