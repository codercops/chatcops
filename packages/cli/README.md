# @chatcops/cli

The `chatcops` command: build a knowledge index from your site, and search it to check what your bot will find.

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

Exit codes: 0 when everything worked, 1 when it finished with failed pages or discovery errors, 2 when it couldn't run (bad options, config problems, a different embedder than the index was built with).

TypeScript config files need Node 22.18 or later; on older Node, use `chatcops.config.mjs`.
