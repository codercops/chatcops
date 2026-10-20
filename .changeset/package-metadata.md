---
"@chatcops/core": patch
"@chatcops/server": patch
"@chatcops/widget": patch
---

Add `homepage`, `bugs`, `keywords` and `engines` (`node >=22`) to the package metadata, so npm links to the docs and the issue tracker. Core and server are marked `sideEffects: false` for tree shaking. The widget isn't, because importing it starts the widget.
