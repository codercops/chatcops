---
"@chatcops/widget": patch
---

Validate stored conversations before restoring them. Invalid top-level structures and malformed JSON are cleared from storage, and messages without a valid user or assistant role and string content are filtered out.
