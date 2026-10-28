---
"@chatcops/core": minor
---

New `VectorStore` interface (`vectors` on `ChatCopsStorage`) for embedded chunks of a site's pages, with `upsert`, `query` (cosine similarity), an optional `keywordQuery` and `deleteBySource`. `memoryVectors({ dimensions })` keeps them in memory and does BM25 keyword search with `Intl.Segmenter`, so Japanese and Chinese work. `runStorageConformance` checks `vectors` when a store has them. The server doesn't search vectors yet.
