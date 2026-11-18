---
"@chatcops/ingest": minor
---

`contextualize: { provider }` has a model write a short context for each chunk before it is embedded (contextual retrieval): the context is embedded with the chunk, the stored text stays the chunk, and the context is kept in its metadata. The page goes in the system prompt so a provider that caches prompts reads it once, a dry run asks no model, and turning it on or off, or changing the model, embeds pages again. `IngestStats` gains `contextualized` and `modelTokens`.
