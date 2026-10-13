---
"@chatcops/server": patch
---

Return the `capture_lead` tool result without waiting for webhook delivery. Deliveries now run in the background and are awaited before the stream ends, and each webhook request times out after 10 seconds.
