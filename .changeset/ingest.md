---
"@chatcops/ingest": minor
---

New package: `ingest()` builds a knowledge index from a site. It discovers pages from sitemaps (indexes and `.xml.gz` too), URL lists and folders of Markdown/MDX/HTML; fetches with conditional requests, a timeout and limited concurrency; extracts readable content as Markdown with Readability, after removing hidden elements, scripts and comments; chunks along headings without splitting code blocks or tables; embeds and writes to any `VectorStore`. A manifest in a `KeyValueStore` makes re-runs embed only what changed, `prune` never runs after a discovery error, and an index refuses an embedder other than the one that built it.
