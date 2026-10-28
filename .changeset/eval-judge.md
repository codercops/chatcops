---
"@chatcops/cli": minor
---

`judge` assertions in `chatcops test`: a model grades the reply against a rubric from 0 to 1 and passes at `threshold` (default 0.7). The default judge is the cheap model of a provider other than the bot's; `--judge-model provider:model` or `judge` in the config picks another. Without a key for it the run refuses to start, and every run prints the judge it used. Judge calls are recorded and replayed with the rest.

`prices` in the config (US dollars per million tokens, by model id) gives each turn and judge call a cost, and the run prints what it spent. `--max-cost <usd>` stops starting turns once a run has spent that much; it needs prices for the models in use. Reporters get a run summary (mode, judge, cost) in `onEnd`.
