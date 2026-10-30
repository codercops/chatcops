---
"@chatcops/cli": patch
---

`chatcops search` now uses `ingest.index` from the config when `--index` isn't passed, the same index `chatcops ingest` builds.
