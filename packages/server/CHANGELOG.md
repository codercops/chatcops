# @chatcops/server

## 0.5.0

### Minor Changes

- f406cf9: Stop the provider when the visitor disconnects. `ProviderChatParams` takes a `signal`, which all three providers pass to their SDK and check between tool rounds. `handleChat(body, clientIp, { signal })` stops quietly on abort and doesn't save the partial reply. The Express adapter aborts when the response closes early; the Vercel and Cloudflare adapters abort when the response stream is cancelled, and the Cloudflare adapter no longer throws an unhandled rejection after a disconnect. The Cloudflare handler accepts the Workers `(request, env, ctx)` arguments and uses `ctx.waitUntil` so lead webhooks still finish.
- 6e5147f: Visitor-supplied page context and pre-chat answers no longer go into the system prompt, where they had the same authority as the site's own instructions. They are sent in a `<visitor_context>` block in front of the visitor's latest message (not stored), with values that can't close the block early and a 4,000 character cap, and the system prompt tells the model to treat that block as information, never as instructions. The site's system prompt and knowledge base are unchanged. `locale` is only used when it looks like a language tag.
- 3a4b9b8: Webhook deliveries are now signed over the raw body and can be verified with the new `verifyWebhook()` helper. Each request has an `X-ChatCops-Signature: t=<seconds>,v1=<hmac>` header, and the body is `{ id, type, created, data }` with a stable event id for deduplication (the old `event` and `timestamp` fields are still there; the `signature` field in the body is gone). 429 responses are retried and `Retry-After` is honored, redirects aren't followed, and a delivery that fails for good is logged without the body. Webhook URLs must be https and can't point at loopback, private or link-local addresses unless the webhook sets `allowPrivateNetwork: true`. The reply's `done` event is now sent before waiting for webhooks, so a slow receiver no longer delays the end of the visitor's reply.

### Patch Changes

- a1829e6: Errors that were swallowed before now show up in the server logs with the `[chatcops]` prefix: unexpected errors in the Express, Vercel and Cloudflare adapters, and a lead capture callback that throws. Logs carry the error and where it happened, never request bodies or lead data. Errors after a visitor disconnects aren't logged. What visitors see is unchanged.
- 8ba3987: Preserve the previous assistant message during regenerate until the new reply is saved, and avoid deleting earlier answers on retry.
- Updated dependencies [f406cf9]
- Updated dependencies [a1829e6]
- Updated dependencies [e694ba4]
- Updated dependencies [3a4b9b8]
  - @chatcops/core@0.4.0

## 0.4.0

### Minor Changes

- 2e1b955: Support configuring a custom `conversationStore` in `ChatCopsServerConfig`.
- de08282: Add `maxTokens` and `temperature` to the server config and pass them to the provider.

### Patch Changes

- 66d0858: Send the configured CORS header with 400 and 405 error responses across the Cloudflare, Vercel, and Express server adapters.
- 0550fc3: Deprecate the `i18n` option, which the server never read. Setting it now logs a warning.
- 6a5f8b8: Restore user message when regenerating a conversation with no existing user message to answer, and keep retries idempotent.
- Updated dependencies [ce073a4]
  - @chatcops/core@0.3.2

## 0.3.3

### Patch Changes

- a31d5c6: Return immediately from the tool executor when capturing leads without awaiting webhook delivery. Pending deliveries are tracked and awaited with `Promise.allSettled` before the final `done` response to prevent dropped webhooks on serverless hosts, and webhook `fetch` calls use `AbortSignal.timeout` to prevent hanging indefinitely.

## 0.3.2

### Patch Changes

- 957a63b: Build the Cloudflare Worker handler once and reuse it, rather than rebuilding
  it inside `fetch`. Rebuilding per request gave every request a fresh
  conversation store and rate limiter, so the bot forgot earlier messages and
  rate limiting never engaged. The handler is now created lazily on the first
  request, because the API key is a Worker secret that only exists there.
- 1a74af9: Make `cors` optional in `ChatCopsServerConfig`, defaulting to `'*'`.
- 54da4c6: Limit the pre-chat `userData` in a request to 50 fields with names of up to 100 characters, and put only the first 2,000 characters of the page URL into the system prompt. Requests with longer page URLs are still accepted.
- 8eee3e7: Reuse the same chat handler and `AnalyticsCollector` between `chatcopsMiddleware` and `chatcopsAnalyticsHandler` (keyed by the config object) so the analytics endpoint reports real traffic instead of zeros and no duplicate providers or cleanup intervals are created.
- 7bfee10: Update Express example and documentation to use `app.all('/chat', ...)` so cross-origin `OPTIONS` preflight requests reach the adapter.

## 0.3.1

### Patch Changes

- Updated dependencies [5ab63bc]
  - @chatcops/core@0.3.1

## 0.3.0

### Minor Changes

- b650792: Add retry and regenerate support for widget conversations, including assistant message regeneration, retryable error bubbles, and server-side conversation updates for regenerate requests.

### Patch Changes

- 5bc33eb: Add configurable pre-chat form for collecting user info before conversation. Supports text, email, select, and textarea fields with validation. Form data is sent to the server and injected into the system prompt.
- 45d02ae: Execute provider tool calls during chat loops so streaming and sync responses can continue after tool use. This also wires successful lead-capture tool executions into the server analytics, webhook flow, and widget lead-captured callbacks/events.
- 4ce9d5a: Add a configurable timeout guard for tool execution so hanging tools fail gracefully instead of blocking provider responses indefinitely.
- Updated dependencies [b650792]
- Updated dependencies [45d02ae]
- Updated dependencies [4ce9d5a]
  - @chatcops/core@0.3.0

## 0.2.1

### Patch Changes

- 959b5f2: Add README.md to all packages with install instructions, usage examples, and API reference
- Updated dependencies [959b5f2]
  - @chatcops/core@0.2.1

## 0.2.0

### Minor Changes

- ee92c50: Initial release of ChatCops packages with AI provider abstraction, server adapters, and embeddable chat widget.

### Patch Changes

- Updated dependencies [ee92c50]
  - @chatcops/core@0.2.0
