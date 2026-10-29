---
"@chatcops/server": patch
---

`createChatHandler` now throws when `retention.conversationsDays` is 0, negative or not a finite number. Before, 0 or a negative value made `purge()` delete every conversation.
