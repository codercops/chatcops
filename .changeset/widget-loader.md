---
"@chatcops/widget": minor
---

The script tag build is now a small loader. `chatcops.min.js` (about 3 kB gzipped) draws the chat button and loads the chat panel (`chatcops.panel.js`, next to it) when the visitor hovers or clicks it, or when the page opens the chat, shows a welcome bubble or uses inline mode. Until then it reads no storage and makes no requests. The CDN snippet doesn't change. To self-host, copy both files, or use `chatcops.full.min.js`, which is the whole chat in one file as before. In the loader, `ChatCops.init()` returns nothing, and the other `ChatCops` methods work before and after the chat loads.
