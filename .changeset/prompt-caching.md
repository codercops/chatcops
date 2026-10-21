---
"@chatcops/core": minor
---

Claude requests now mark the system prompt and tools as a cached prefix, so repeat requests read them from the prompt cache. Turn it off with `promptCaching: false`. Steps and `runTurn()` take a new `systemContext` for instructions that change per request (knowledge base excerpts, the visitor's language), sent after the cached prefix so it stays the same from one request to the next. Cache reads and writes are reported in `usage`.
