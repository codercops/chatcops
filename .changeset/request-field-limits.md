---
'@chatcops/server': patch
---

Limit the pre-chat `userData` in a request to 50 fields with names of up to 100 characters, and put only the first 2,000 characters of the page URL into the system prompt. Requests with longer page URLs are still accepted.
