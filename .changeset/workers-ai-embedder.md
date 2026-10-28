---
"@chatcops/core": minor
---

Add `workersAiEmbedder` for Cloudflare Workers AI embeddings using the native `env.AI` binding (`@cf/baai/bge-m3` at 1024 dimensions by default), with automatic batching up to 100 texts and response validation.
