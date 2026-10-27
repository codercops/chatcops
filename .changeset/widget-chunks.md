---
"@chatcops/widget": patch
---

The pre-chat form and the Turnstile helper are now separate files in `dist/chunks/`, loaded by the chat panel only on sites that use them. The panel is about 0.6 kB smaller for everyone else. Self-hosted sites need to copy `dist/chunks/` next to `chatcops.panel.js`. The single-file and ESM builds still include everything.

If the pre-chat form's file fails to load, the chat opens without the form and logs the error, instead of leaving an empty panel.
