# @chatcops/ingest

## 0.1.0

### Minor Changes

- a9c1c60: New package: the `chatcops` command. `chatcops ingest` builds or updates a knowledge index from `chatcops.config.ts` or `--source` (sitemaps, page URLs, folders), with `--dry-run`, `--max-pages`, `--concurrency`, `--prune`, `--force`, `--index` and `--json` (one JSON object per line). `chatcops search` shows what retrieval finds for a question. Both refuse an embedder other than the one the index was built with. Exit codes: 0 done, 1 finished with failed pages or discovery errors, 2 could not run.

  `ingest()` takes `maxPages`; a capped run never prunes.

- eb4107c: New package: `ingest()` builds a knowledge index from a site. It discovers pages from sitemaps (indexes and `.xml.gz` too), URL lists and folders of Markdown/MDX/HTML; fetches with conditional requests, a timeout and limited concurrency; extracts readable content as Markdown with Readability, after removing hidden elements, scripts and comments; chunks along headings without splitting code blocks or tables; embeds and writes to any `VectorStore`. A manifest in a `KeyValueStore` makes re-runs embed only what changed, `prune` never runs after a discovery error, and an index refuses an embedder other than the one that built it.
- 2e66f57: Respect robots.txt by default during ingestion, with per-origin policy caching, allow/disallow matching and crawl-delay scheduling. Add respectRobots to opt out for network sources; local files are unaffected.

  Report unavailable robots policies as per-origin errors and skip pruning during outages, instead of treating them as successful runs blocked by explicit rules.

### Patch Changes

- aa0576d: `chatcops test` runs eval files against your bot: YAML conversations (`evals/**/*.chat.yaml`, or `.chat.ts`/`.chat.mjs` modules) with assertions on each reply. It uses the config's new `server` section and runs through the real request path with fresh in-memory storage, tool mocks, page context, locale, `repeat` and `passRate`. Options: `--filter` (name or `tag:x`), `--repeat`, `--concurrency`, `--reporter pretty|json` (repeatable) and `--json`. Exit 0 when all passed, 1 when some failed, 2 when it couldn't run. This first version has the `contains` assertion (and `not-contains`); more are coming.

  `ingest` and `search` now say what's missing from the config when they run, so a config with only `server` works for `chatcops test`.

  `globToRegExp` in `@chatcops/ingest`: `**/` now also matches no folder, so `docs/**/*.md` matches `docs/intro.md`.

- Updated dependencies [897f8e3]
- Updated dependencies [bd6f3c8]
- Updated dependencies [304f1df]
- Updated dependencies [3ee5fdc]
- Updated dependencies [b0bd38d]
- Updated dependencies [4e86624]
- Updated dependencies [a714a12]
- Updated dependencies [8d6223d]
- Updated dependencies [f535508]
- Updated dependencies [e22060d]
- Updated dependencies [9d36629]
- Updated dependencies [d890cbe]
- Updated dependencies [100475b]
- Updated dependencies [7ecd228]
- Updated dependencies [b66fd9f]
- Updated dependencies [86085c0]
- Updated dependencies [a029c43]
  - @chatcops/core@0.6.0
