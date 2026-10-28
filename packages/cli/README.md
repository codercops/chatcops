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

`chatcops test` runs eval files (`evals/**/*.chat.yaml` by default) against the bot in the config's `server` section:

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

Options: `--filter` (a name, or `tag:<name>`), `--repeat`, `--concurrency`, `--json`. It exits 0 when all tests passed, 1 when some failed, 2 when it couldn't run. See [Testing your bot](https://chat.codercops.com/core/testing/).

Exit codes for ingest and search: 0 when everything worked, 1 when it finished with failed pages or discovery errors, 2 when it couldn't run (bad options, config problems, a different embedder than the index was built with).

TypeScript config files need Node 22.18 or later; on older Node, use `chatcops.config.mjs`.
