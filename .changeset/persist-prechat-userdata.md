---
"@chatcops/widget": patch
---

Persist and restore pre-chat `userData` across widget recreation and send `userData` with every request.

- Persist pre-chat `userData` in `sessionStorage` alongside the completion flag.
- Restore pre-chat `userData` when a widget instance initializes so the welcome message greets returning visitors by name after `destroy()` and recreation in the same tab.
- Send `userData` on every chat request instead of only the first request.
- When `preChatForm` is disabled, do not restore, store, or send form answers.
