---
"@chatcops/core": patch
---

The Claude provider now uses `@anthropic-ai/sdk` 1.x, which talks to Claude's API version 2026-10-21. That version removed `temperature`, so it's never sent to Claude: a configured `temperature` logs one warning and is left out. Claude 4.7 and later, including the default `claude-haiku-5-5`, already ignored it. On older Claude models a lowered `temperature` no longer has an effect; use `effort` instead.
