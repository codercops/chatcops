---
"@chatcops/core": minor
---

Ready-made retrievers: `vectorRetriever` searches a vector store by meaning, and `hybridRetriever` also searches by words and merges both by rank (reciprocal rank fusion, k = 60), which finds product names and codes that meaning alone misses. Both take `candidates` and an optional `reranker` (new `Reranker` interface), and refuse an embedder whose vectors don't match the store's size. A short or follow-up question is searched together with the visitor's previous one (`retrievalQueryText`). `reciprocalRankFusion` is exported too.
