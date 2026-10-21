---
"@chatcops/widget": minor
---

The widget asks for protocol v1 (`protocol: 1` in the request body) and reads its typed parts. Servers before 0.6 ignore the field and answer in the old format, which the widget still reads. With a v1 server, replies keep the id the server saved them under, so regenerate names the exact reply to replace, and a stream that ends without its `finish` part shows "cut off" with Retry instead of passing as a finished answer. Unknown part types are ignored.
