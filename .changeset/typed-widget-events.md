---
"@chatcops/widget": patch
---

`ChatCops.on()` and `widget.on()` type each handler by its event, so `on('message', (message) => ...)` gets a `MessageData` and `on('error', (error) => ...)` an `Error`. A handler typed `(...args: unknown[]) => void` still works. `WidgetEvents` and `MessageData` are exported.
