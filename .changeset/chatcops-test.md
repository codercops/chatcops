---
"@chatcops/cli": minor
"@chatcops/ingest": patch
---

`chatcops test` runs eval files against your bot: YAML conversations (`evals/**/*.chat.yaml`, or `.chat.ts`/`.chat.mjs` modules) with assertions on each reply. It uses the config's new `server` section and runs through the real request path with fresh in-memory storage, tool mocks, page context, locale, `repeat` and `passRate`. Options: `--filter` (name or `tag:x`), `--repeat`, `--concurrency`, `--json`. Exit 0 when all passed, 1 when some failed, 2 when it couldn't run. This first version has the `contains` assertion (and `not-contains`); more are coming.

`ingest` and `search` now say what's missing from the config when they run, so a config with only `server` works for `chatcops test`.

`globToRegExp` in `@chatcops/ingest`: `**/` now also matches no folder, so `docs/**/*.md` matches `docs/intro.md`.
