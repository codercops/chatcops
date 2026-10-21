---
"@chatcops/core": minor
---

Importing `@chatcops/core` no longer loads the Claude, OpenAI and Gemini SDKs, which cuts serverless cold-start time. To get there, `ClaudeProvider`, `OpenAIProvider` and `GeminiProvider` are no longer exported from the package root. Import them from their own subpaths instead: `@chatcops/core/providers/claude`, `@chatcops/core/providers/openai` and `@chatcops/core/providers/gemini`. `createProvider()` is unchanged and still loads only the SDK for the provider you configure.
