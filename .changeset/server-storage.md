---
"@chatcops/server": minor
---

New `storage` option: pass a store package (`postgresStorage(...)`, and Redis, SQLite and Cloudflare stores as they land) and conversations, plus the one-reply-at-a-time lock, are shared by every server instance. `conversationStore` still works but is deprecated, and setting both is an error. On Vercel, Lambda, Netlify or Workers with no storage set, the server warns once that memory doesn't last there. The handler also returns `purge()`, which deletes conversations older than `retention.conversationsDays` (default 30).
