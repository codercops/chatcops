---
"@chatcops/core": minor
---

Add `runTurn()`, the loop that runs one reply: model steps, the tools the model asks for, and saving the reply as it grows. It yields protocol v1 parts and returns the reply as a `ChatMessage` with parts, status and token usage. It works with providers written for 0.4 that only have `chat()`, too.

`chat()` and `chatSync()` on the Claude, OpenAI and Gemini providers now run on `runTurn()`. They behave as before, with three differences: `chatSync()` streams under the hood, a tool timeout now aborts the tool's signal, and an OpenAI-compatible server that ends a tool step with `stop` gets its tools run.

Also new: `toolRegistry()`, an optional `emits()` on tools (`LeadCaptureTool` uses it to add a `lead-captured` part), and `scriptedProvider()` at `@chatcops/core/testing/provider` for testing without a model.
