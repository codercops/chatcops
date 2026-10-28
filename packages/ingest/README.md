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

## robots.txt

Network sources respect `robots.txt` by default. Each run fetches it once per origin, selecting `ChatCopsBot` rules (or `*`), with the longest matching rule winning and `allow` winning ties. Wildcards and `$` end anchors are supported. Disallowed pages are skipped with the reason `blocked by robots.txt`.

A 4xx response allows crawling; a 5xx response or an unreachable robots server blocks it. Up to five redirects are followed. `crawl-delay` (seconds) sets a minimum interval between requests to an origin, including concurrent workers. Directory sources read local files and never check robots. Set `respectRobots: false` in the ingest config to opt out.

`robotsFor(origin, fetch)` also exposes `Sitemap:` entries as `sitemaps`; ingestion still uses the sources you configure.

When robots.txt is unavailable, affected pages are skipped with a reason such as `robots.txt unavailable (HTTP 503)`. The run reports one error per origin and skips pruning, preserving existing indexed pages until the rules can be read again.
