---
'@chatcops/server': patch
---

The Express example mounts the handler with `app.use('/chat', ...)`, so the widget's `/chat/session` request reaches it, and its test command gets a session token first. The Vercel example says to add `api/chat/session.ts`.
