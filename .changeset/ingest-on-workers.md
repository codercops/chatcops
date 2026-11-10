---
'@chatcops/ingest': patch
---

Ingest runs on Cloudflare Workers. Pages were converted to Markdown by turndown's browser build there, which needs a `document` a Worker doesn't have, so every page failed with "document is not defined". turndown now gets a page parsed by domino, the parser its Node build already uses, so the Markdown is the same everywhere.
