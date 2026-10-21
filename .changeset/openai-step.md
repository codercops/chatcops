---
"@chatcops/core": minor
---

Add `OpenAIProvider.step()`. It asks for token usage with `stream_options.include_usage`, and if an OpenAI-compatible server rejects that option, it retries once without it and stops asking. A step that ends with `stop` but has tool calls (Ollama does this) counts as a tool step. Arguments that aren't valid JSON are reported with an `inputError` instead of being run.
