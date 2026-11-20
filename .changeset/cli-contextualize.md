---
"@chatcops/cli": minor
---

`chatcops ingest --contextualize` has the model in `ingest.contextualize.provider` write a short context for each chunk before it is embedded, and stops with a message when the config has none. Without the flag a run never asks a model. The summary and `--json` report the chunks that got a context and the model tokens used.
