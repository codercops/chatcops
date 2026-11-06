---
'@chatcops/core': minor
'@chatcops/server': minor
---

Each finished reply is saved with `metadata.answered`, and `metadata.unansweredReason` (`refusal`, `no_retrieval` or `no_citation`) when it didn't answer, for an answer rate and a list of questions the knowledge doesn't cover. `checkAnswered()` in `@chatcops/core` is the same check.
