---
"@chatcops/server": major
---

Session tokens are required by default. A server without `sessionSecrets` refuses to start unless it sets `allowAnonymous: true`, so a chat can't be left open to guessed or leaked conversation ids by accident. `requireSession` is removed: `requireSession: false` is now `allowAnonymous: true` next to `sessionSecrets`, and `true` was already the default. The widget fetches tokens itself from 0.6, but it asks `<chat url>/session`, so with Express mount the handler with `app.use('/chat', ...)`, and on Vercel or Next.js add a `/session` route that re-exports the chat route. `chatcops test` runs the server in process without needing tokens. See [Upgrading to 1.0](https://chat.codercops.com/getting-started/upgrading-to-1/).
