---
"@chatcops/widget": patch
---

Reset the request timeout on received stream data so active long replies can complete. Expose the inactivity timeout in milliseconds through WidgetConfig.timeout while preserving request cancellation.
