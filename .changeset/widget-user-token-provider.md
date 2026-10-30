---
"@chatcops/widget": minor
---

`userToken` can be a function (sync or async) that returns a fresh signed token. The widget calls it once each time it asks the server for a session, not per message. If it throws, rejects or takes over 5 seconds, the session starts without the visitor and a warning is logged. A string still works as before.
