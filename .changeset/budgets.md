---
"@chatcops/core": minor
"@chatcops/server": minor
---

Budgets: limits on tokens, replies and dollars per conversation, per IP per UTC day, and overall per day, counted on a `CounterStore` so they hold across instances. Core has `createBudgetGuard()`, and `runTurn()` takes a `budget` that is checked before each model request, charged after it, and caps the reply length to the tokens left. The server's new `budgets` option turns it on. A used-up budget ends the reply with `budget_exceeded` (`provider_error` for widgets before 0.6) without calling the model. Off unless configured, for now.
