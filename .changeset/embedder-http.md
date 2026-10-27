---
"@chatcops/core": patch
---

`openaiEmbedder` now keeps `batchSize` between 1 and 2048 (what OpenAI accepts), so a value of 0 no longer loops forever. The OpenAI, Voyage and Gemini embedders share one implementation of retries and batching, with no change in behavior.
