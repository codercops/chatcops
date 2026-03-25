---
'@chatcops/core': patch
'@chatcops/server': patch
---

Add a configurable timeout guard for tool execution so hanging tools fail gracefully instead of blocking provider responses indefinitely.
