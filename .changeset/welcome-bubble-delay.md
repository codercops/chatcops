---
"@chatcops/widget": patch
---

A `data-welcome-bubble-delay` that isn't whole milliseconds, such as `3s`, now falls back to the default delay instead of being read as 3 ms.
