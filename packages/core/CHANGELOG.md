# @chatcops/core

## 0.4.0

### Minor Changes

- f406cf9: Stop the provider when the visitor disconnects. `ProviderChatParams` takes a `signal`, which all three providers pass to their SDK and check between tool rounds. `handleChat(body, clientIp, { signal })` stops quietly on abort and doesn't save the partial reply. The Express adapter aborts when the response closes early; the Vercel and Cloudflare adapters abort when the response stream is cancelled, and the Cloudflare adapter no longer throws an unhandled rejection after a disconnect. The Cloudflare handler accepts the Workers `(request, env, ctx)` arguments and uses `ctx.waitUntil` so lead webhooks still finish.
- e694ba4: Upgrade the provider SDKs and the default models.

  - Claude: `@anthropic-ai/sdk` 0.135. The default model is now `claude-haiku-5-5`. Thinking blocks are sent back unchanged between tool rounds, and a refusal or a context window overflow is reported as an error instead of an empty reply.
  - OpenAI: `openai` 7. The default model is now `gpt-5-mini`. Requests send `max_completion_tokens` (set `maxTokensParam: 'max_tokens'` for servers that need the old name), and tool calls run in parallel like the other providers.
  - Gemini: moves from the deprecated `@google/generative-ai` to `@google/genai`. The default model is now `gemini-3.5-flash-lite`, because Google shut down the old default `gemini-2.0-flash`. Function results carry the call id, and thought signatures are kept between tool rounds.
  - New provider options: `effort` (default `'low'`), `baseURL` for proxies and OpenAI-compatible servers such as Ollama or OpenRouter, `organization` for OpenAI, and `maxTokensParam`.
  - `temperature` is left out, with a one-time warning, on models that reject it (Claude 5.x, Claude Opus 4.7 and later, OpenAI reasoning models).
  - The default `maxTokens` goes from 1024 to 4096, because thinking tokens count toward it.
  - History sent to a provider now always starts with a user message, and consecutive messages from the same side are merged. This fixes Gemini errors after about 50 exchanges and after a failed reply. `normalizeHistory` is exported.

  Migration: if you relied on the old default models, set `model` explicitly. `@google/generative-ai` is no longer installed with `@chatcops/core`; add it to your own dependencies if your code imports it directly.

- 3a4b9b8: Webhook deliveries are now signed over the raw body and can be verified with the new `verifyWebhook()` helper. Each request has an `X-ChatCops-Signature: t=<seconds>,v1=<hmac>` header, and the body is `{ id, type, created, data }` with a stable event id for deduplication (the old `event` and `timestamp` fields are still there; the `signature` field in the body is gone). 429 responses are retried and `Retry-After` is honored, redirects aren't followed, and a delivery that fails for good is logged without the body. Webhook URLs must be https and can't point at loopback, private or link-local addresses unless the webhook sets `allowPrivateNetwork: true`. The reply's `done` event is now sent before waiting for webhooks, so a slow receiver no longer delays the end of the visitor's reply.

### Patch Changes

- a1829e6: Errors that were swallowed before now show up in the server logs with the `[chatcops]` prefix: unexpected errors in the Express, Vercel and Cloudflare adapters, and a lead capture callback that throws. Logs carry the error and where it happened, never request bodies or lead data. Errors after a visitor disconnects aren't logged. What visitors see is unchanged.

## 0.3.2

### Patch Changes

- ce073a4: Fix missing accents in the Spanish, French and German locale strings (including the opening ¿/¡ in Spanish questions and exclamations) and write the Hindi locale in Devanagari instead of romanized text.

## 0.3.1

### Patch Changes

- 5ab63bc: Strip punctuation from knowledge base queries so trailing characters like "?" no longer prevent a match.

## 0.3.0

### Minor Changes

- b650792: Add retry and regenerate support for widget conversations, including assistant message regeneration, retryable error bubbles, and server-side conversation updates for regenerate requests.

### Patch Changes

- 45d02ae: Execute provider tool calls during chat loops so streaming and sync responses can continue after tool use. This also wires successful lead-capture tool executions into the server analytics, webhook flow, and widget lead-captured callbacks/events.
- 4ce9d5a: Add a configurable timeout guard for tool execution so hanging tools fail gracefully instead of blocking provider responses indefinitely.

## 0.2.1

### Patch Changes

- 959b5f2: Add README.md to all packages with install instructions, usage examples, and API reference

## 0.2.0

### Minor Changes

- ee92c50: Initial release of ChatCops packages with AI provider abstraction, server adapters, and embeddable chat widget.
