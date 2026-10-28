---
"@chatcops/cli": patch
---

`chatcops test` no longer stops the whole run when something throws while a reply is read, such as a knowledge source that can't reach its index (or a replay that has no recording for an embedding call). That test fails with `internal_error` and the message, and the other tests still run.
