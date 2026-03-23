---
"@chatcops/core": patch
"@chatcops/server": patch
"@chatcops/widget": patch
---

Execute provider tool calls during chat loops so streaming and sync responses can continue after tool use. This also wires successful lead-capture tool executions into the server analytics, webhook flow, and widget lead-captured callbacks/events.
