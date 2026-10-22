---
"@chatcops/store-sqlite": minor
---

`extraColumns` and `rowHook` stamp columns you've added (a tenant or site id) on every new conversation and message row, as in `@chatcops/store-postgres`. The hook runs on insert only, undeclared keys throw, and values are always bound as parameters.
