---
"@chatcops/widget": patch
---

A reply whose connection is cut before the server's final `[DONE]` (a proxy timeout or a server crash, for example) now shows a network error and a Retry button under the text received so far. Before, it looked like a finished answer.
