# @chatcops/cli

## 0.1.0

### Minor Changes

- aa0576d: `chatcops test` runs eval files against your bot: YAML conversations (`evals/**/*.chat.yaml`, or `.chat.ts`/`.chat.mjs` modules) with assertions on each reply. It uses the config's new `server` section and runs through the real request path with fresh in-memory storage, tool mocks, page context, locale, `repeat` and `passRate`. Options: `--filter` (name or `tag:x`), `--repeat`, `--concurrency`, `--reporter pretty|json` (repeatable) and `--json`. Exit 0 when all passed, 1 when some failed, 2 when it couldn't run. This first version has the `contains` assertion (and `not-contains`); more are coming.

  `ingest` and `search` now say what's missing from the config when they run, so a config with only `server` works for `chatcops test`.

  `globToRegExp` in `@chatcops/ingest`: `**/` now also matches no folder, so `docs/**/*.md` matches `docs/intro.md`.

- a9c1c60: New package: the `chatcops` command. `chatcops ingest` builds or updates a knowledge index from `chatcops.config.ts` or `--source` (sitemaps, page URLs, folders), with `--dry-run`, `--max-pages`, `--concurrency`, `--prune`, `--force`, `--index` and `--json` (one JSON object per line). `chatcops search` shows what retrieval finds for a question. Both refuse an embedder other than the one the index was built with. Exit codes: 0 done, 1 finished with failed pages or discovery errors, 2 could not run.

  `ingest()` takes `maxPages`; a capped run never prunes.

- 55b6e36: `chatcops test --record` saves every HTTP call the tests make (model, embeddings, tools that call APIs) to `__cassettes__/<eval file>.jsonl`, and `--replay` answers them from there without the network. Replay is the default when `CI` is set; `--live` calls the APIs anyway. Calls are matched by a hash of their method, URL and body, so a changed prompt, model or tool list fails with where the request changed and a note to re-record, instead of passing on an old answer. Headers and key-like query parameters are never saved.
- 07de986: `judge` assertions in `chatcops test`: a model grades the reply against a rubric from 0 to 1 and passes at `threshold` (default 0.7). The default judge is the cheap model of a provider other than the bot's; `--judge-model provider:model` or `judge` in the config picks another. Without a key for it the run refuses to start, and every run prints the judge it used. Judge calls are recorded and replayed with the rest.

  `prices` in the config (US dollars per million tokens, by model id) gives each turn and judge call a cost, and the run prints what it spent. `--max-cost <usd>` stops starting turns once a run has spent that much; it needs prices for the models in use. Reporters get a run summary (mode, judge, cost) in `onEnd`.

- 30525e3: `javascript` assertion: point it at a module (relative to the eval file) and its default export is called with `(turn, conversation)`. Returns a boolean or `{ pass, reason?, score? }`, and may be async. A missing file, a module without a default function, or a throw inside it are failures with the file name in the reason. Modules are loaded once per run.
- f362c92: `chatcops test` has `cites` and `lead-captured` assertions, for the pages a reply cites and the leads a turn captures.
- c488287: Add a grouped, more detailed pretty report for `chatcops test`, including the `--verbose` option.
- 18a77bd: `chatcops test` has `calls-tool` and `no-tool-call` assertions, for checking that a turn calls a tool with expected arguments or makes no unexpected tool calls.
- c9ca76a: `chatcops test` has `tokens-under`, `latency-under` and `cost-under` assertions, to catch replies that get longer, slower or more expensive.

### Patch Changes

- af6345a: Eval recordings save response bodies over 4 kB gzipped in base64 (`encoding: 'gzip'`), so a streamed reply, which is one event per token, takes about a tenth of the space. Request bodies stay readable JSON, so a re-recording's diff still shows what changed.
- c5c81b0: `chatcops test` no longer stops the whole run when something throws while a reply is read, such as a knowledge source that can't reach its index (or a replay that has no recording for an embedding call). That test fails with `internal_error` and the message, and the other tests still run.
- Updated dependencies [5e34537]
- Updated dependencies [897f8e3]
- Updated dependencies [bd6f3c8]
- Updated dependencies [304f1df]
- Updated dependencies [3ee5fdc]
- Updated dependencies [aa0576d]
- Updated dependencies [b0bd38d]
- Updated dependencies [4e86624]
- Updated dependencies [a9c1c60]
- Updated dependencies [a714a12]
- Updated dependencies [cb360ad]
- Updated dependencies [8d6223d]
- Updated dependencies [31d67fb]
- Updated dependencies [eb4107c]
- Updated dependencies [f535508]
- Updated dependencies [e22060d]
- Updated dependencies [2e66f57]
- Updated dependencies [9d36629]
- Updated dependencies [d890cbe]
- Updated dependencies [100475b]
- Updated dependencies [7ecd228]
- Updated dependencies [b66fd9f]
- Updated dependencies [86085c0]
- Updated dependencies [a029c43]
  - @chatcops/server@0.7.0
  - @chatcops/core@0.6.0
  - @chatcops/ingest@0.1.0
