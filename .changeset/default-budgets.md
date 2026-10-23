---
"@chatcops/core": minor
"@chatcops/server": minor
---

The server has budgets on by default: 200 replies per conversation and 2M tokens per IP per UTC day (`DEFAULT_BUDGETS`, filled in by `withDefaultBudgets()`). There's no default daily total. The server logs the budgets in force once at startup. Set a scope in `budgets` to replace its default, set a scope to `false` to turn it off, or pass `budgets: false` to turn them all off.
