---
"@chatcops/widget": minor
---

The widget no longer touches `localStorage` or `sessionStorage` before the visitor opens it. A popup reads its saved conversation on first open, and an inline chat reads it when it mounts. A welcome bubble with `showOnce` checks its flag only when it's due to show.

New `persistence` option: `'local'` (the default, same as before), `'session'` (this tab only) or `'none'` (memory only, nothing is ever written). New `historyTtlDays` option drops saved conversations older than that many days, 30 by default. Both can be set from the script tag with `data-persistence` and `data-history-ttl-days`.

The pre-chat form's answers are now saved with the conversation instead of per tab in `sessionStorage`, so they last and expire with it. A visitor who already has a saved conversation never gets the form on top of it, as before.

`persistHistory` is deprecated. `persistHistory: false` still works and means `persistence: 'none'`.
