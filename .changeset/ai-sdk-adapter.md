---
"@chatcops/server": minor
"@chatcops/core": minor
---

New `chatcopsAiSdkHandler(config)`: a Fetch API handler that the AI SDK's `useChat` can talk to. It reads `useChat` requests and answers in the AI SDK's UI message stream, so an app built on the AI SDK can use a ChatCops server without changing its chat UI. The server keeps the history and reads only the last user message, so a client can't add turns the model never wrote. Server tools show up as tool parts the client doesn't run, a captured lead as a `data-lead-captured` part, and each assistant message has `metadata.conversationId`. A contract test runs the real `ai` 7 client against it.

`@chatcops/core` exports the mapping on its own: `aiSdkEncoder()` and `fromAiSdkRequest()`. `protocolStats()` on the handler now also counts `'ai-sdk'` requests.
