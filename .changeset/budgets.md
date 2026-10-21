---
"@chatcops/core": minor
"@chatcops/server": minor
---

Budgets: limits on tokens, replies and dollars per conversation, per IP per UTC day, and overall per day, counted on a `CounterStore` so they hold across instances. Core has `createBudgetGuard()`, and `runTurn()` takes a `budget` that is checked before each model request, charged after it, and caps the reply length to the tokens left. A used-up budget ends the reply with `budget_exceeded` (`provider_error` for widgets before 0.6) without calling the model.

The server has budgets on by default: 200 replies per conversation and 2M tokens per IP per UTC day (`DEFAULT_BUDGETS`, filled in by `withDefaultBudgets()`). There's no default daily total. The server logs the budgets in force once at startup. Set a scope in `budgets` to replace its default, set a scope to `false` to turn it off, or pass `budgets: false` to turn them all off.
