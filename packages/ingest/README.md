# @chatcops/ingest

Turns a website into a knowledge index a ChatCops bot can answer from, with citations. It discovers pages (sitemaps, URL lists, folders of Markdown or HTML), fetches and extracts the readable content, splits it into chunks along headings, embeds them, and writes them to a vector store.

```ts
import { memoryStorage, memoryVectors, openaiEmbedder } from '@chatcops/core';
import { ingest } from '@chatcops/ingest';

const embedder = openaiEmbedder({ apiKey: process.env.OPENAI_API_KEY! });
const stats = await ingest({
  sources: [{ type: 'sitemap', url: 'https://example.com/sitemap.xml' }],
  embedder,
  store: memoryVectors({ dimensions: embedder.dimensions }),
  manifest: memoryStorage().kv!,
});
console.log(stats);
```

Use a persistent vector store (`@chatcops/store-postgres`, `store-sqlite`, `store-cloudflare` or `store-upstash-vector`) and the same storage's key-value store as the manifest, so later runs only embed what changed.

- Re-running is cheap: unchanged pages (same ETag, or the same extracted text) aren't fetched again or embedded again.
- Hidden elements, scripts, styles and HTML comments are removed before extraction, since that's where injected instructions usually hide.
- `prune: true` removes pages that are no longer discovered, but never after a sitemap failed to load.
- An index remembers its embedder and refuses another one; build a new index with a different `index` name instead.
- `dryRun: true` discovers, extracts and chunks without embedding or writing anything.

Node 22.13 or later.
