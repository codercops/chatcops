---
"@chatcops/cli": minor
"@chatcops/ingest": minor
---

New package: the `chatcops` command. `chatcops ingest` builds or updates a knowledge index from `chatcops.config.ts` or `--source` (sitemaps, page URLs, folders), with `--dry-run`, `--max-pages`, `--concurrency`, `--prune`, `--force`, `--index` and `--json` (one JSON object per line). `chatcops search` shows what retrieval finds for a question. Both refuse an embedder other than the one the index was built with. Exit codes: 0 done, 1 finished with failed pages or discovery errors, 2 could not run.

`ingest()` takes `maxPages`; a capped run never prunes.
