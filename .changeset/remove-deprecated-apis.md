---
"@chatcops/core": major
"@chatcops/server": major
"@chatcops/widget": major
---

Removes the APIs that 0.6 to 0.8 deprecated. Each one now fails at startup with a message naming the replacement, and [Upgrading to 1.0](https://chat.codercops.com/getting-started/upgrading-to-1/) has a step for each.

- Server: `cors` (use `allowedOrigins`), `conversationStore` (use `storage: { conversations }`), `i18n` (ignored since 0.6), and the `RateLimiter` and `RateLimitConfig` exports (use `createRateLimiter` from `@chatcops/core`). Webhook bodies no longer repeat `event` and `timestamp`: read `type` and `created`.
- Core: analytics stats drop `leadsCapture` (use `leadsCaptured`), and the `noun:verb` event names are no longer read as `noun.verb` ones or repeated in `eventCounts`. Events a store saved under them still count.
- Core: the Claude, OpenAI and Gemini providers no longer have `chat()` and `chatSync()`; use `runTurn()`. On `AIProvider`, `chat()` is optional and `chatSync()` is gone, so a custom provider needs `step()` or `chat()`.
- Widget: `persistHistory` (use `persistence: 'none'`). Setting it throws, so a site that asked for nothing to be saved never starts saving.
