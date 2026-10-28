---
"@chatcops/core": patch
"@chatcops/store-postgres": patch
---

Keyword search in the pgvector store now matches pages with any of the question's words, ranked by how well they match, instead of only pages with all of them. The storage conformance suite checks this for every store.
