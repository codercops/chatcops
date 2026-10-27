---
"@chatcops/core": minor
"@chatcops/server": minor
---

Retrieval building blocks. `KnowledgeSource` has an optional `retrieve(query)` that returns chunks with their source page. When a source has it, the server calls it with the conversation so far, for follow-up questions, and gives the model every source's chunks as one numbered block, fenced as reference material that never contains instructions. Sources with only `getContext` work as before.

New in core: the `Embedder`, `Retriever`, `RetrievedChunk` and `RetrievalQuery` types, `openaiEmbedder` (fetch only, `text-embedding-3-small` at 1024 dimensions by default, with retries on rate limits), `retrieverKnowledge` and `formatSources`.
