---
"@chatcops/server": minor
"@chatcops/widget": minor
---

Signed-in visitors. With `identity: { secret }` on the server, your site signs a `userToken` (an HS256 JWT with `sub`, `exp` and an optional `tier`) and the widget sends it with `/session` (`userToken` or `data-user-token`). The user id goes into the session token and is stored on the conversation, so the same user can resume it with a fresh token and nobody else can. `identity.tiers` gives a tier its own budgets.
