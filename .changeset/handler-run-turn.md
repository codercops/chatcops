---
"@chatcops/server": minor
---

The handler now runs every reply through core's `runTurn()`. The stream widgets receive is the same as in 0.5. What changes:

- Each reply is saved as one assistant message with its parts (text, tool calls and their results), status and token usage, written after each tool round.
- One reply per conversation at a time: a second message sent while a reply is still streaming gets `provider_error`.
- Knowledge base excerpts, the visitor-context note and the locale line go after the system prompt instead of into it, so Claude's prompt cache can hold the system prompt.
- Tools get a signal that also aborts on `toolTimeoutMs`, and a tool's `emits()` decides what it adds to the reply.
