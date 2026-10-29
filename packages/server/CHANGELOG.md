# @chatcops/server

## 0.7.0

### Minor Changes

- 897f8e3: Analytics events are named `noun.verb` now: `conversation.started`, `message.sent`, `message.received` and `lead.captured`, also exported as `ANALYTICS_EVENTS`. The old `noun:verb` names keep working until 1.0. `track()` and `getEvents()` read them as the new ones, stats count events a store saved under either, and `eventCounts` has both keys, so the numbers carry on across the upgrade. Stats gain `leadsCaptured`. `leadsCapture`, the same number, is deprecated. A custom `EventSink` now receives the new names. Webhook event names don't change.
- b0bd38d: Answers now cite the pages they came from. Chunks from knowledge sources with `retrieve` are passed to the turn as `sources`, and each page the reply cites becomes a `source` part (once per page), streamed after the text and saved with the reply. Claude gets the chunks as `search_result` blocks and cites them natively; other providers get a numbered `<sources>` block and cite with `[n]`, and numbers that match no source are removed from the text. New in core: `sources` on `runTurn` and provider step params, `citations: 'native'` on providers, a `source` provider event, and `CitationParser`/`parseCitations`/`sourcePart`.
- cb360ad: The types that make up a config are now exported, so a site can name them: `ThemeConfig`, `ThemeMode`, `PreChatField`, `PreChatFormConfig`, `Persistence`, `MessageStatus` and `MessageErrorType` from `@chatcops/widget`, and `TurnstileConfig` from `@chatcops/server`.
- 31d67fb: Signed-in visitors. With `identity: { secret }` on the server, your site signs a `userToken` (an HS256 JWT with `sub`, `exp` and an optional `tier`) and the widget sends it with `/session` (`userToken` or `data-user-token`). The user id goes into the session token and is stored on the conversation, so the same user can resume it with a fresh token and nobody else can. `identity.tiers` gives a tier its own budgets.
- e22060d: A `Logger` for everything ChatCops writes: `logger` in the server config gets startup notes, refused requests and every error the server handles instead of throwing, each with a stable `event` name (`provider_error`, `tool_error`, `webhook_failed`, `origin_refused`, …). The default `consoleLogger()` prints the same `[chatcops] …` lines as before; `jsonLogger()` writes one JSON object per line, and any object with `debug`/`info`/`warn`/`error` works. Tools get the logger as `context.logger`, and `runTurn`, providers (`ProviderConfig.logger`), `ConversationManager` and `BufferedEventSink` take one too.

  **Tool errors:** when a tool throws, the model now sees only `Tool failed: <name>`, and the full error is logged as `tool_error`. Before, the thrown message went to the model, which could repeat a database error or a connection string to the visitor. Return `{ success: false, message }` to tell the model something it can pass on. Timeouts and cancelled replies keep their messages.

  Console lines for errors that come with an error object no longer end in a colon (`[chatcops] Provider error` and the error), and `describeBudgets` and `describeSecurity` no longer start with `[chatcops] `, since the logger adds it.

- 9d36629: Retrieval building blocks. `KnowledgeSource` has an optional `retrieve(query)` that returns chunks with their source page. When a source has it, the server calls it with the conversation so far, for follow-up questions, and gives the model every source's chunks as one numbered block, fenced as reference material that never contains instructions. Sources with only `getContext` work as before.

  New in core: the `Embedder`, `Retriever`, `RetrievedChunk` and `RetrievalQuery` types, `openaiEmbedder` (fetch only, `text-embedding-3-small` at 1024 dimensions by default, with retries on rate limits), `retrieverKnowledge` and `formatSources`.

- 86085c0: `ChatCops.setUser({ name, email, token })` and `ChatCops.setContext(data)`. `setUser` sets the signed-in visitor's identity token for the server, and sends `name` and `email` as visitor details with the first message of each conversation; switching users or `setUser(null)` clears the chat. `setContext` adds details for the next messages, such as `{ plan: 'Team' }`, sent as the new `pageContext.data` (at most 20 string fields), which the server shows the model as page details that aren't verified. With the script tag loader both are kept until the chat loads, without loading it early or touching storage.

  Visitor details are now sent again with the first message of a new conversation on a v1 server, which keeps them from that message.

### Patch Changes

- 5e34537: 405 responses now include `Allow: POST, OPTIONS`.
- Updated dependencies [897f8e3]
- Updated dependencies [bd6f3c8]
- Updated dependencies [304f1df]
- Updated dependencies [3ee5fdc]
- Updated dependencies [b0bd38d]
- Updated dependencies [4e86624]
- Updated dependencies [a714a12]
- Updated dependencies [8d6223d]
- Updated dependencies [f535508]
- Updated dependencies [e22060d]
- Updated dependencies [9d36629]
- Updated dependencies [d890cbe]
- Updated dependencies [100475b]
- Updated dependencies [7ecd228]
- Updated dependencies [b66fd9f]
- Updated dependencies [86085c0]
- Updated dependencies [a029c43]
  - @chatcops/core@0.6.0

## 0.6.0

### Minor Changes

- 79fea7e: New `chatcopsAiSdkHandler(config)`: a Fetch API handler that the AI SDK's `useChat` can talk to. It reads `useChat` requests and answers in the AI SDK's UI message stream, so an app built on the AI SDK can use a ChatCops server without changing its chat UI. The server keeps the history and reads only the last user message, so a client can't add turns the model never wrote. Server tools show up as tool parts the client doesn't run, a captured lead as a `data-lead-captured` part, and each assistant message has `metadata.conversationId`. A contract test runs the real `ai` 7 client against it.

  `@chatcops/core` exports the mapping on its own: `aiSdkEncoder()` and `fromAiSdkRequest()`. `protocolStats()` on the handler now also counts `'ai-sdk'` requests.

- f7fb16a: New `allowedOrigins` option: the sites whose pages can use the chat, as exact origins or subdomain wildcards (`'https://*.acme.com'`). A browser request from any other page gets 403 `origin_not_allowed` before the model is called, with CORS headers so the page can read why. Responses echo the matched origin with `Vary: Origin`. Requests without an `Origin` header still pass. The default is still any origin (`['*']`).

  `cors` is deprecated and read as a one-item `allowedOrigins`, with one warning. Setting both is an error. One change for `cors` users: a request without an `Origin` header no longer gets `Access-Control-Allow-Origin` back, which only browsers read, and browsers always send `Origin` on cross-origin requests.

- 955809f: Budgets: limits on tokens, replies and dollars per conversation, per IP per UTC day, and overall per day, counted on a `CounterStore` so they hold across instances. Core has `createBudgetGuard()`, and `runTurn()` takes a `budget` that is checked before each model request, charged after it, and caps the reply length to the tokens left. A used-up budget ends the reply with `budget_exceeded` (`provider_error` for widgets before 0.6) without calling the model.
- 0d666f2: The server has budgets on by default: 200 replies per conversation and 2M tokens per IP per UTC day (`DEFAULT_BUDGETS`, filled in by `withDefaultBudgets()`). There's no default daily total. The server logs the budgets in force once at startup. Set a scope in `budgets` to replace its default, set a scope to `false` to turn it off, or pass `budgets: false` to turn them all off.
- 5cf6116: The handler now runs every reply through core's `runTurn()`. The stream widgets receive is the same as in 0.5. What changes:

  - Each reply is saved as one assistant message with its parts (text, tool calls and their results), status and token usage, written after each tool round.
  - One reply per conversation at a time: a second message sent while a reply is still streaming gets `provider_error`.
  - Knowledge base excerpts, the visitor-context note and the locale line go after the system prompt instead of into it, so Claude's prompt cache can hold the system prompt.
  - Tools get a signal that also aborts on `toolTimeoutMs`, and a tool's `emits()` decides what it adds to the reply.

- 47ed5f1: Tools can describe their input with a full JSON Schema in `inputSchema`: nested objects, arrays, `enum`, `anyOf` and `$ref` all go to Claude, OpenAI and Gemini as written. The flat `parameters` form from 0.4 still works and is converted to the same schema.

  - `execute(input, context)` now gets a second argument with the `conversationId` and an `AbortSignal` that fires when the visitor leaves. Tools that ignore it keep working.
  - Tools can carry `annotations` (`title`, `readOnlyHint`, `destructiveHint`).
  - The server checks tool definitions when it starts and throws a `ToolDefinitionError` that lists every problem: an invalid or duplicate name, an `inputSchema` whose root isn't `type: 'object'`, both `inputSchema` and `parameters` set, or a `required` key that isn't in `parameters`. Before, these failed as a provider error on the first message.
  - New exports: `toolInputSchema`, `legacyParametersToSchema`, `validateTools`, `ToolDefinitionError`, and the `ToolContext` and `ToolAnnotations` types. `ToolDefinition.parameters` and `required` are now optional.

- f9e13f1: Pre-chat form answers are stored with the conversation from its first message, and later requests can't change them, so a visitor can't rewrite their details mid-conversation. The new `preChatFields` option keeps only the listed fields and drops anything else a request sends. Once a 0.6 server has answered, the widget stops sending the answers with every message.
- 639a50c: The server speaks protocol v1. A request with `"protocol": 1` in the body (what the 0.6 widget sends) or an `x-chatcops-protocol: 1` header gets typed parts (`start`, `text-delta`, `finish` and so on) and a response header `x-chatcops-protocol: 1`. Requests without it get exactly the 0.5 stream, and the server logs one line the first time it answers one.

  In protocol v1, a request that can't be answered gets a real HTTP status with a JSON body and CORS headers: 400 `invalid_request`, 409 `conversation_busy`, 413 `payload_too_large` (bodies over 256 KB), 429 `rate_limited` with `Retry-After`, 503 `provider_unavailable`. Errors after the stream starts are an `error` part, then `finish`.

  All three adapters now share one module for this, so they send the same headers (`Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, and no `Connection`, which HTTP/2 doesn't allow) and one `[DONE]`. When nothing has been sent for 10 seconds, as during a slow tool, they send a `: ping` comment so proxies and the widget don't close the connection. The CORS preflight allows the `Authorization` and `X-ChatCops-Protocol` headers.

  New: `exposeUsage: true` adds token usage to the v1 `finish` part. `createChatHandler()` has `startChat()`, which resolves a refusal or the reply's v1 parts, for custom adapters, and `protocolStats()`, which counts requests in each format. `@chatcops/core/protocol` exports the protocol types and helpers on their own, for clients that don't need the rest of core.

- 6d80bc9: The server's `provider` option also takes a provider object (anything with `step()` or `chat()`), for providers ChatCops doesn't ship and for tests with `scriptedProvider()`. Core exports `isAIProvider()` to tell the two apart.
- 332e588: Regenerate can name the reply to replace: `regenerate: { assistantMessageId }`. `true` still works. Retrying a message whose reply was already saved sends that reply again instead of asking the model for a second one, and a partial reply is replaced once a new one succeeds. A reply the visitor walked away from is now saved, marked `aborted`, and left out of what the model sees next.
- be6ef6a: The server logs its security settings once at startup (where the chat is allowed from, session tokens, Turnstile), plus an error or a warning for mistakes it can spot: an allowed origin without `http://` or `https://`, or with a path, query, fragment or trailing slash; an `http://` origin that isn't local; `"*"` next to other origins; a session secret that's also the value of a `NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `NUXT_PUBLIC_`, `EXPO_PUBLIC_` or `REACT_APP_` variable; two secrets that are the same.
- 7c27f8c: With `analytics: true` and a `storage` that has an event sink, the server writes analytics events there too, buffered with `BufferedEventSink` and flushed before each reply's stream ends, so serverless runtimes don't drop them. `chatcopsAnalyticsHandler` then counts from the store, so the stats cover every instance, for `?from=` and `?to=` in milliseconds (default: the last 30 days). The handler's new `analyticsStats(range)` does the same; `getAnalytics()` still describes this process only.
- a01dd3e: Rate limits now count on the storage's counters (`createRateLimiter` from core, a sliding window), so with a shared store a limit holds across every server instance instead of per process. The handler starts no timers anymore, so it can be created at global scope on Workers; `cleanup()` is kept but does nothing. The `RateLimiter` export is deprecated.
- 8c582e4: New `storage` option: pass a store package (`postgresStorage(...)`, and Redis, SQLite and Cloudflare stores as they land) and conversations, plus the one-reply-at-a-time lock, are shared by every server instance. `conversationStore` still works but is deprecated, and setting both is an error. On Vercel, Lambda, Netlify or Workers with no storage set, the server warns once that memory doesn't last there. The handler also returns `purge()`, which deletes conversations older than `retention.conversationsDays` (default 30).
- ad1d9db: Session tokens. With `sessionSecrets` set, `POST <chat url>/session` gives a short-lived token bound to one conversation and the page's origin, and chat requests need it as `Authorization: Bearer <token>` (401 `session_required`, `token_expired` or `conversation_mismatch` otherwise). A conversation that has messages is resumed only with a token that was issued for it, so a guessed id gets a new conversation. An id with nothing stored yet is given out as is. `requireSession: false` lets requests without a token through while older widgets are around. Adds the `conversation_mismatch` error code to protocol v1.
- da93824: The visitor's IP, which rate limits and the per-IP budget key on, is only read from headers a platform sets itself.

  - `chatcopsVercelHandler` reads Vercel's headers only when it runs on Vercel. Elsewhere it no longer trusts the first `X-Forwarded-For` entry, which a visitor can set to get a fresh limit with every request. Set the new `clientIp` option to read your host's header (Netlify's `x-nf-client-connection-ip`, or one your proxy sets). Until then per-IP limits are skipped, with one warning.
  - `chatcopsCloudflareHandler` reads `CF-Connecting-IP`, and also takes `clientIp`.
  - Express keeps `req.ip`, and warns once when requests carry `X-Forwarded-For` while `trust proxy` is off.
  - A request without a known IP skips per-IP limits instead of sharing one `"unknown"` limit with every other such visitor.

- 545963f: Cloudflare Turnstile when a session is issued. With `turnstile: { secretKey }` on the server, `/session` checks a Turnstile token with Cloudflare before signing (401 `turnstile_failed` otherwise, 503 when Cloudflare can't be reached), and a refresh with the previous token skips it. The widget's `turnstileSiteKey` (`data-turnstile-site-key`) loads Cloudflare's script only when it first needs a session and renders the challenge in the page, outside the shadow root.
- c892542: Add `analyticsToken` option to require a bearer token on `chatcopsAnalyticsHandler`

### Patch Changes

- fd80586: Conversations are written with `append` instead of rewriting the whole conversation, so two server instances answering the same conversation no longer lose each other's messages, when the store supports it.

  - `ConversationManager` takes `storage` (a `ChatCopsStorage`) as well as `store`, and defaults to `memoryStorage()`, which is bounded, instead of the unbounded `MemoryStore`.
  - A store with only `get`, `save` and `delete` still works; the manager adds the other methods with `withAppend()` and logs one warning that concurrent writes from two instances can lose a message.
  - A conversation is saved with its first message, not when it's first read.
  - The history sent to the model is trimmed by an estimated token budget (32,000 by default, `maxHistoryTokens`), keeping the visitor's first message and the newest ones, instead of by message count. `trimHistory()` and `estimateTokens()` are exported. The stored cap (`maxMessages`, 100) still applies, now through atomic removes, and still never leaves an assistant turn first.
  - New `appendMessages()` (with `expectedVersion`), `updateMessage()`, `getHistory()` and `acquireTurn()`, which keeps two replies from being generated for one conversation at once, across instances when the storage has `kv`.

- 8e3e79e: Add `homepage`, `bugs`, `keywords` and `engines` (`node >=22`) to the package metadata, so npm links to the docs and the issue tracker. Core and server are marked `sideEffects: false` for tree shaking. The widget isn't, because importing it starts the widget.
- ad584a4: A provider that fails to set up (an unknown `provider.type`, or an SDK that throws on a missing key) no longer stops the server process at startup. The failure is logged once with the `[chatcops] Provider setup failed:` prefix, without the API key or config, and every chat request gets the same `provider_error` a failed reply already gets.
- Updated dependencies [79fea7e]
- Updated dependencies [955809f]
- Updated dependencies [b138ded]
- Updated dependencies [e1e5e79]
- Updated dependencies [c2963af]
- Updated dependencies [0d666f2]
- Updated dependencies [c34a8d4]
- Updated dependencies [d320b44]
- Updated dependencies [1ca06e1]
- Updated dependencies [47ed5f1]
- Updated dependencies [aa3bb33]
- Updated dependencies [e8795ca]
- Updated dependencies [fd80586]
- Updated dependencies [049c52c]
- Updated dependencies [0578d5c]
- Updated dependencies [8e3e79e]
- Updated dependencies [1c76cf8]
- Updated dependencies [639a50c]
- Updated dependencies [6d80bc9]
- Updated dependencies [238eaef]
- Updated dependencies [332e588]
- Updated dependencies [be2ad74]
- Updated dependencies [ad1d9db]
- Updated dependencies [96372c8]
- Updated dependencies [f930e9c]
- Updated dependencies [3dd7dc8]
- Updated dependencies [545963f]
  - @chatcops/core@0.5.0

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
