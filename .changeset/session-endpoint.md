---
"@chatcops/server": minor
"@chatcops/core": minor
---

Session tokens. With `sessionSecrets` set, `POST <chat url>/session` gives a short-lived token bound to one conversation and the page's origin, and chat requests need it as `Authorization: Bearer <token>` (401 `session_required`, `token_expired` or `conversation_mismatch` otherwise). A conversation is resumed only with a token that was issued for it, so a guessed id gets a new conversation. `requireSession: false` lets requests without a token through while older widgets are around. Adds the `conversation_mismatch` error code to protocol v1.
