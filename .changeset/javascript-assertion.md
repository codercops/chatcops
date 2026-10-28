---
"@chatcops/cli": minor
---

`javascript` assertion: point it at a module (relative to the eval file) and its default export is called with `(turn, conversation)`. Returns a boolean or `{ pass, reason?, score? }`, and may be async. A missing file, a module without a default function, or a throw inside it are failures with the file name in the reason. Modules are loaded once per run.
