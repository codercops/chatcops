---
"@chatcops/server": minor
"@chatcops/widget": patch
---

Pre-chat form answers are stored with the conversation from its first message, and later requests can't change them, so a visitor can't rewrite their details mid-conversation. The new `preChatFields` option keeps only the listed fields and drops anything else a request sends. Once a 0.6 server has answered, the widget stops sending the answers with every message.
