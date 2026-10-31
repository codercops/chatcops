---
'@chatcops/server': patch
---

A webhook `Retry-After` of `-1`, or numbers with no day or month name, falls back to the usual backoff again instead of retrying at once. `Date.parse` read them as dates long past.
