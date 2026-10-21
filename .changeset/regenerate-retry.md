---
"@chatcops/server": minor
"@chatcops/core": patch
---

Regenerate can name the reply to replace: `regenerate: { assistantMessageId }`. `true` still works. Retrying a message whose reply was already saved sends that reply again instead of asking the model for a second one, and a partial reply is replaced once a new one succeeds. A reply the visitor walked away from is now saved, marked `aborted`, and left out of what the model sees next.
