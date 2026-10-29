# @chatcops/cli

The `chatcops` command: build a knowledge index from your site, search it to check what your bot will find, and test your bot against conversations it has to get right.

```bash
npx chatcops ingest --source https://example.com/sitemap.xml
npx chatcops search "how much is the Team plan?"
```

Both read `chatcops.config.ts` (or `.mts`, `.js`, `.mjs`) in the current folder:

```ts
import { openaiEmbedder } from '@chatcops/core';
import { defineConfig } from '@chatcops/cli';
import { postgresStorage, fromPostgresJs } from '@chatcops/store-postgres';
import postgres from 'postgres';

export default defineConfig({
  embedder: openaiEmbedder({ apiKey: process.env.OPENAI_API_KEY! }),
  storage: postgresStorage({ db: fromPostgresJs(postgres(process.env.DATABASE_URL!)), dimensions: 1024 }),
  ingest: {
    sources: [{ type: 'sitemap', url: 'https://example.com/sitemap.xml' }],
    exclude: ['**/blog/**'],
  },
});
```

`chatcops ingest` options: `--source` (repeatable; a sitemap, a page URL, or a folder with `--base-url`), `--index`, `--dry-run`, `--max-pages`, `--concurrency`, `--prune`, `--force`, `--json`. `chatcops search` options: `--index`, `--top-k`, `--json`. Run `chatcops --help` for details.

`chatcops test` runs eval files (`evals/**/*.chat.yaml` by default) against the bot in the config's `server` section. Use `--url https://example.com/chat` to run the same eval files against a deployed server instead; URL mode does not require a `server` config or config file. Add repeatable `--header "Name: value"` arguments for authenticated endpoints. Tool mocks are unsupported in URL mode because the CLI cannot apply them to a remote server.

```yaml
version: 1
name: Pricing
tests:
  - name: quotes the Team price
    turns:
      - user: How much is the Team plan?
        expect:
          - contains: "$19"
          - not-contains: "$29"
```

Options: `--filter` (a name, or `tag:<name>`), `--repeat`, `--concurrency`, `--verbose`, `--reporter pretty|json` (repeatable), `--json`. The pretty report groups tests by file and includes run duration, assertion counts, available bot-token usage and total elapsed time. By default, assertion details are shown for failed tests; `--verbose` shows them for every test. `--record` saves the HTTP requests and responses the CLI makes to `__cassettes__/` next to the eval files, and `--replay` answers them from there. In URL mode, the remote chat request and stream are recorded; replay doesn't contact the server, and API calls made inside the deployed server aren't part of the cassette. The remote server's rate limits apply; use `--concurrency 1` for a smoke test. Replay is the default when `CI` is set, so CI needs no API keys. `judge` assertions have a model from another provider grade a reply against a rubric (`--judge-model` to choose it), and with `prices` in the config, `--max-cost` stops a run once it has spent that much. It exits 0 when all tests passed, 1 when some failed, 2 when it couldn't run. See [Testing your bot](https://chat.codercops.com/core/testing/).

To inspect failure formatting without calling a live AI provider, build the CLI and run its deterministic fake-provider demo from the repository root:

```bash
pnpm --filter @chatcops/cli build
node packages/cli/dist/bin.js test packages/cli/tests/fixtures/reporter-failure.chat.yaml --config packages/cli/tests/fixtures/reporter-failure.config.mjs --live --verbose
```

The demo intentionally fails an assertion and exits with code 1; that is expected.

Exit codes for ingest and search: 0 when everything worked, 1 when it finished with failed pages or discovery errors, 2 when it couldn't run (bad options, config problems, a different embedder than the index was built with).

TypeScript config files need Node 22.18 or later; on older Node, use `chatcops.config.mjs`.
