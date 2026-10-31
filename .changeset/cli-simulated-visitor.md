---
"@chatcops/cli": minor
---

A test in an eval file can use `simulate` instead of `turns`: a second model (the judge) plays the visitor from a `persona` for up to `maxTurns` messages, stopping when it answers `DONE` or, with `stopWhen: lead-captured`, when the bot captures a lead. A test-level `expect` is checked once, on the last turn, with the whole conversation. The visitor's calls are recorded and replayed like the judge's, and count in the cost and `--max-cost`.
