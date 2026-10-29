# @chatcops/widget

## 0.7.0

### Minor Changes

- b93e221: Add configurable suggested question buttons to new widget conversations.
- cb360ad: The types that make up a config are now exported, so a site can name them: `ThemeConfig`, `ThemeMode`, `PreChatField`, `PreChatFormConfig`, `Persistence`, `MessageStatus` and `MessageErrorType` from `@chatcops/widget`, and `TurnstileConfig` from `@chatcops/server`.
- 31d67fb: Signed-in visitors. With `identity: { secret }` on the server, your site signs a `userToken` (an HS256 JWT with `sub`, `exp` and an optional `tier`) and the widget sends it with `/session` (`userToken` or `data-user-token`). The user id goes into the session token and is stored on the conversation, so the same user can resume it with a fresh token and nobody else can. `identity.tiers` gives a tier its own budgets.
- d9c8ea6: Add locale-aware text direction and language attributes for RTL widget support.
- 3ff10e0: The chat now starts with a note that the visitor is talking to an AI ("You're chatting with an AI assistant. It can make mistakes."), as the EU AI Act asks (Article 50). It's on by default, stays first in the log (also after a new conversation), and has `role="note"`. `disclosure: { text, learnMoreUrl }` (or `data-disclosure-text`, `data-disclosure-url`) changes the wording and adds a link; `disclosure: false` (`data-disclosure="false"`) removes it and logs a console notice that telling visitors is then up to you. New locale strings: `disclosure`, `disclosureLearnMore`.
- da756fe: More of the widget API, on `window.ChatCops` (script tag builds) and the npm default export: `toggle()`, `sendMessage(text, { open? })` to send as the visitor from your own buttons, `newConversation()` to start fresh, `clear()` to also remove the saved transcript and pre-chat answers, `registerLocale(code, strings, { dir? })` for a language the widget doesn't ship, and `version`. With the script tag loader they work before the chat has loaded: the first call loads it. A reply still coming when the conversation is reset is stopped and never lands in the new one. `WidgetLocaleStrings` is exported for typing your strings.
- cc19259: Light, dark and auto themes. `theme.mode` (`data-theme-mode`) is `auto` by default and follows the visitor's system setting, switching live; `light` and `dark` pin one. `theme.accentDark` (`data-accent-dark`) sets a separate accent for dark mode.

  **This changes how existing sites look:** the widget used to be dark everywhere, and is now light on light systems. Set `theme.mode: 'dark'` to keep the old look, which is exactly the dark preset. A config that sets `bgColor` or `textColor` without `mode` keeps the mode its colors were made for, so custom dark themes don't turn into light text on light panels. Errors and code blocks now use the `--cc-danger`, `--cc-code-bg` and `--cc-pre-bg` tokens.

- f1ff788: The script tag build is now a small loader. `chatcops.min.js` (about 3 kB gzipped) draws the chat button and loads the chat panel (`chatcops.panel.js`, next to it) when the visitor hovers or clicks it, or when the page opens the chat, shows a welcome bubble or uses inline mode. Until then it reads no storage and makes no requests. The CDN snippet doesn't change. To self-host, copy both files, or use `chatcops.full.min.js`, which is the whole chat in one file as before. In the loader, `ChatCops.init()` returns nothing, and the other `ChatCops` methods work before and after the chat loads.
- d09b5a7: Translations can now ship as one file per language in `dist/locales/<code>.js`. The script tag loader fetches the file for `locale` (or `data-locale`) next to the panel, at the same time as the panel, and falls back to English with a warning when there's none. Bundler users import `@chatcops/widget/locales/<code>` and pass it as `strings`. A site's own `strings` still win over the translation. No languages ship yet; they're added one per pull request.
- 59e8486: The widget no longer touches `localStorage` or `sessionStorage` before the visitor opens it. A popup reads its saved conversation on first open, and an inline chat reads it when it mounts. A welcome bubble with `showOnce` checks its flag only when it's due to show.

  New `persistence` option: `'local'` (the default, same as before), `'session'` (this tab only) or `'none'` (memory only, nothing is ever written). New `historyTtlDays` option drops saved conversations older than that many days, 30 by default. Both can be set from the script tag with `data-persistence` and `data-history-ttl-days`.

  The pre-chat form's answers are now saved with the conversation instead of per tab in `sessionStorage`, so they last and expire with it. A visitor who already has a saved conversation never gets the form on top of it, as before.

  `persistHistory` is deprecated. `persistHistory: false` still works and means `persistence: 'none'`.

- cf184c7: Show source pages under assistant replies. A reply that cites pages now shows a labelled "Sources" list of links beneath it. Sources survive a page reload. Non-http(s) URLs are never rendered as links.
- 08b4647: `ChatCops.update(changes)` changes the running chat without loading it again: the theme (all but `position`), `branding`, `placeholder`, `strings`, `disclosure`, `welcomeMessage` and `suggestions`. Fields left out keep their current values. A chat that has only its welcome message shows the new one; once the visitor has written, the new welcome message and suggestions are used from the next conversation. In the script tag build, calls made before the chat loads are kept until it does, and the launcher takes the new theme right away.
- 86085c0: `ChatCops.setUser({ name, email, token })` and `ChatCops.setContext(data)`. `setUser` sets the signed-in visitor's identity token for the server, and sends `name` and `email` as visitor details with the first message of each conversation; switching users or `setUser(null)` clears the chat. `setContext` adds details for the next messages, such as `{ plan: 'Team' }`, sent as the new `pageContext.data` (at most 20 string fields), which the server shows the model as page details that aren't verified. With the script tag loader both are kept until the chat loads, without loading it early or touching storage.

  Visitor details are now sent again with the first message of a new conversation on a v1 server, which keeps them from that message.

### Patch Changes

- 5ef0242: Announce completed assistant replies once for screen readers.
- b8c5ed6: Add Arabic widget translations, loaded only for visitors using Arabic.
- d6c857f: Show unread reply count in the launcher badge and accessible name.
- 15d5b10: Add Simplified Chinese widget translations, loaded only for visitors using Chinese.
- 095829b: Add Dutch widget translations, loaded only for visitors using Dutch.
- 75903b4: Add source labels and AI disclosure translations to 11 widget locales.
- 83e0d3f: Add --cc-focus-ring on :host for visible keyboard focus indicators across widget controls.
- 9632988: Add French widget translations, loaded only for visitors using French.
- 458fb3c: Add German widget translations, loaded only for visitors using German.
- 316f625: Add Hebrew widget translations, loaded only for visitors using Hebrew.
- fa8df0d: Add Hindi widget translations, loaded only for visitors using Hindi.
- 26a4086: Add Italian widget translations, loaded only for visitors using Italian.
- 2c1f49a: Add Japanese widget translations, loaded only for visitors using Japanese.
- 3896eb0: Add Korean widget translations, loaded only for visitors using Korean.
- 95f58dd: Use logical CSS properties for widget styles so layout and message bubbles adapt to right-to-left languages.
- 983d7d6: Lock document scrolling on mobile screens (640px and below) when the chat panel is open in full-screen mode, and restore original overflow on close or destroy. Update mobile breakpoint to 640px, add safe-area insets, and set mobile input font size to 16px to prevent auto-zooming on mobile devices.
- 82822a6: Keep keyboard focus inside the open popup chat.
- f73ecf8: Add Portuguese widget translations, loaded only for visitors using Portuguese.
- 535e23a: Add Spanish widget translations, loaded only for visitors using Spanish.
- 6cf2674: `ChatCops.on()` and `widget.on()` type each handler by its event, so `on('message', (message) => ...)` gets a `MessageData` and `on('error', (error) => ...)` an `Error`. A handler typed `(...args: unknown[]) => void` still works. `WidgetEvents` and `MessageData` are exported.
- e51822f: Add Urdu widget translations, loaded only for visitors using Urdu.
- 7665dcb: Make the welcome bubble text keyboard-accessible.
- f5416e2: A `data-welcome-bubble-delay` that isn't whole milliseconds, such as `3s`, now falls back to the default delay instead of being read as 3 ms.
- 0d35733: The pre-chat form and the Turnstile helper are now separate files in `dist/chunks/`, loaded by the chat panel only on sites that use them. The panel is about 0.6 kB smaller for everyone else. Self-hosted sites need to copy `dist/chunks/` next to `chatcops.panel.js`. The single-file and ESM builds still include everything.

  If the pre-chat form's file fails to load, the chat opens without the form and logs the error, instead of leaving an empty panel.

- f4ce2c8: The panel is about 240 B smaller gzipped (16.6 kB) and the single-file build about 300 B (18.62 kB): the minifier now also renames 55 more private class members, each checked to be used only inside its class.
- 5dc1fc6: Long replies stream without slowing the page down: finished paragraphs render once, and only the one being written re-renders, at most once a frame, instead of the whole reply on every chunk. The log follows new text only while it's scrolled to the bottom, so a visitor reading an earlier message isn't pulled away. The finished reply renders exactly as before.

## 0.6.0

### Minor Changes

- 545963f: Cloudflare Turnstile when a session is issued. With `turnstile: { secretKey }` on the server, `/session` checks a Turnstile token with Cloudflare before signing (401 `turnstile_failed` otherwise, 503 when Cloudflare can't be reached), and a refresh with the previous token skips it. The widget's `turnstileSiteKey` (`data-turnstile-site-key`) loads Cloudflare's script only when it first needs a session and renders the challenge in the page, outside the shadow root.
- 5b31899: Clearer messages when a reply can't happen. The widget now reads the server's reason and says it: too many messages, with the wait in seconds when the server sends one; the conversation or the day's budget used up; the assistant unavailable (the provider couldn't be set up); or the reply cut off. Each one is a new `strings` key (`errorRateLimitWait`, `errorBudget`, `errorBudgetDaily`, `errorUnavailable`, `errorCutOff`). The script tag bundle's size budget goes from 14 kB to 14.5 kB (18 kB for ESM) to fit them.
- 79a2253: Session tokens. When the server has them on and a chat request gets a 401, the widget gets a token from `<apiUrl>/session`, keeps it in `localStorage`, and sends the request again with `Authorization: Bearer`. The saved token lets the server resume the conversation after a reload, and the widget moves to a new conversation id when the server gives one. Servers without session tokens see no change.
- 4aa886d: The widget asks for protocol v1 (`protocol: 1` in the request body) and reads its typed parts. Servers before 0.6 ignore the field and answer in the old format, which the widget still reads. With a v1 server, replies keep the id the server saved them under, so regenerate names the exact reply to replace, and a stream that ends without its `finish` part shows "cut off" with Retry instead of passing as a finished answer. Unknown part types are ignored.

### Patch Changes

- e13dfc9: Assistant replies now carry `data-ai-generated="true"`, so scripts, extensions and CSS can tell model-written text apart. User messages and the welcome message don't get it.
- 8e3e79e: Add `homepage`, `bugs`, `keywords` and `engines` (`node >=22`) to the package metadata, so npm links to the docs and the issue tracker. Core and server are marked `sideEffects: false` for tree shaking. The widget isn't, because importing it starts the widget.
- f9e13f1: Pre-chat form answers are stored with the conversation from its first message, and later requests can't change them, so a visitor can't rewrite their details mid-conversation. The new `preChatFields` option keeps only the listed fields and drops anything else a request sends. Once a 0.6 server has answered, the widget stops sending the answers with every message.
- 5ad6b1a: A reply whose connection is cut before the server's final `[DONE]` (a proxy timeout or a server crash, for example) now shows a network error and a Retry button under the text received so far. Before, it looked like a finished answer.
- 43d3d57: The script tag bundle is 37 bytes smaller (gzipped): the inline icons no longer repeat an `xmlns` attribute, and the stylesheet drops the default `ease` keyword from its transitions. The widget looks and behaves the same.
- 785a00a: Validate stored conversations before restoring them. Invalid top-level structures and malformed JSON are cleared from storage, and messages without a valid user or assistant role and string content are filtered out.
- 2104c3b: Remove the `require` export condition. It pointed at the script tag bundle, which never sets `module.exports`, so `require('@chatcops/widget')` returned an empty object. CommonJS code now gets a clear `ERR_PACKAGE_PATH_NOT_EXPORTED` error; use `import` instead. The `main` field and the `dist/chatcops.min.js` file that the CDN snippet loads are unchanged. The build also always writes the type declarations now, even after an earlier local build.

## 0.5.0

### Minor Changes

- 80704a3: Maintain a persistent registry of ChatCops event handlers across widget initialization and re-initialization, return an unsubscribe function from ChatCops.on(), and export WidgetEventType.
- 1ad2c02: Two widgets on one page now keep separate conversations. Each widget gets its own host element (`chatcops-root`, then `chatcops-root-2` and so on, all with the class `chatcops-root`) and destroying one no longer removes another's host. A new `siteId` option names a widget's saved conversation. Without it, a single widget uses the same storage keys as before, and a second widget on the page gets its own automatically, also across the script tag and bundled builds.

### Patch Changes

- a55f095: Text on the accent color now always reaches WCAG AA contrast (4.5:1). With the default accent, white text in the visitor's own messages was at 4.47:1. The widget now picks the text color from `theme.accent`: white when it passes, near-black on light accents (which keep their exact color), or white on a slightly darker shade of the accent. Icons on the launcher and send button use the same text color. New CSS variables: `--cc-on-accent` and `--cc-accent-contrast`.
- 2b43de8: Messages whose id contains a quote or a backslash can be updated and removed again. The widget now compares ids directly instead of putting them in a CSS selector.
- 9decd23: When a reply fails after some of it has streamed, the widget keeps that text and shows the error as a short note under it, with Retry as before. Before, the error message replaced the whole bubble. A failure that throws partway through also no longer adds a second copy of the bubble.
- 58a4511: The closed popup panel and the hidden welcome bubble are out of the tab order and hidden from screen readers. Escape closes the open popup and moves focus back to the launcher, which now has `aria-expanded` and `aria-controls`, and the panel is a labeled dialog.

## 0.4.4

### Patch Changes

- fd9edf3: Screen readers now announce new chat messages and the typing indicator, and the message box has an accessible name.
- 70fa9c3: Move hardcoded English UI text and aria-labels into `WidgetLocaleStrings`.

  New keys added to `WidgetLocaleStrings`:

  - `openChat` – aria-label for the FAB when the panel is closed
  - `defaultName` – default branding name shown in the panel header ("AI Assistant")
  - `defaultSubtitle` – default branding subtitle ("Online")
  - `greetingWithName` – welcome greeting when the visitor's name is known; supports a `{name}` placeholder
  - `selectPlaceholder` – default option text for select fields in the pre-chat form; supports a `{label}` placeholder
  - `dismissBubble` – aria-label for the welcome bubble dismiss button

  The existing `sendButton` and `closeButton` keys are now also used as aria-labels for the send and close buttons respectively.

  The bubble dismiss button gains `type="button"` and an `aria-label`.

- 2227526: Persist and restore pre-chat `userData` across widget recreation and send `userData` with every request.

  - Persist pre-chat `userData` in `sessionStorage` alongside the completion flag.
  - Restore pre-chat `userData` when a widget instance initializes so the welcome message greets returning visitors by name after `destroy()` and recreation in the same tab.
  - Send `userData` on every chat request instead of only the first request.
  - When `preChatForm` is disabled, do not restore, store, or send form answers.

- 2e53ad7: Reset the request timeout on received stream data so active long replies can complete. Expose the inactivity timeout in milliseconds through WidgetConfig.timeout while preserving request cancellation.

## 0.4.3

### Patch Changes

- e7f9de4: Render `#` to `######` headings and `*`/`+` bullet lists in chat replies, and stop treating asterisks with spaces around them (like `5 * 3`) as italic.

## 0.4.2

### Patch Changes

- 19d4d7a: Improve keyboard focus visibility and respect reduced-motion preferences.
- d453af6: Fix browser global IIFE export to allow `window.ChatCops.init()` directly without `.default`, and capture `document.currentScript` before deferring auto-init on DOMContentLoaded.
- a53385b: Avoid sending or clearing chat messages when Enter confirms an IME composition, including Safari's keyCode 229 case.
- b3029f3: Respect a false auto-open attribute and cancel pending auto-open timers on destroy.
- fb49364: Fix inline panel visibility when close() is called
- 7494c32: Keep code literal in markdown rendering by stashing fenced code blocks and inline code as placeholders before any other transformation, so `*`, `**`, `[text](url)`, `- `, and `1. ` inside code no longer produce formatting, links, or lists, and newlines inside `<pre><code>` are preserved instead of becoming `<br>`.
- 88cd44a: Treat a numeric `borderRadius` (such as `12` or `'12'`) as pixels instead of writing invalid CSS, and accept numbers in the `ThemeConfig` and `WidgetConfig` types.
- 26923e2: Limit pre-chat fields and chat messages to server-accepted lengths
- c3b9771: Associate pre-chat labels with uniquely identified fields, add `aria-required`/`aria-invalid`/`aria-describedby` error accessibility attributes, and disable native form validation so translated widget validation messages are shown.
- 72c4c97: Stop a late reply from overwriting saved history after `destroy()`: `ChatClient.sendMessage` now accepts an optional `AbortSignal` (alongside its timeout), `destroy()` aborts the in-flight request, and a reply that finishes after the widget is destroyed no longer calls `saveHistory()`, `onMessage`, `onError`, or `emit()` — including when `ChatCops.init()` is called again.
- 758f2ff: Hide the popup launcher while chat is open on mobile so it no longer covers the send button or textbox.

## 0.4.1

### Patch Changes

- 6074d1b: Fix ordered lists rendering as bare `<li>` elements without an `<ol>` wrapper, and stop inserting `<br>` between list items.

## 0.4.0

### Minor Changes

- 5bc33eb: Add configurable pre-chat form for collecting user info before conversation. Supports text, email, select, and textarea fields with validation. Form data is sent to the server and injected into the system prompt.
- b650792: Add retry and regenerate support for widget conversations, including assistant message regeneration, retryable error bubbles, and server-side conversation updates for regenerate requests.

### Patch Changes

- 45d02ae: Execute provider tool calls during chat loops so streaming and sync responses can continue after tool use. This also wires successful lead-capture tool executions into the server analytics, webhook flow, and widget lead-captured callbacks/events.

## 0.3.2

### Patch Changes

- 19398fb: Only render markdown links with http, https, mailto, tel or relative URLs. Links with any other scheme, such as javascript: or data:, are shown as plain text.

## 0.3.1

### Patch Changes

- 959b5f2: Add README.md to all packages with install instructions, usage examples, and API reference

## 0.3.0

### Minor Changes

- b354641: Add inline display mode to the widget. Set `mode: 'inline'` with a `container` element to render the chat panel directly inside a page element instead of as a floating popup. Export `Widget` class for creating multiple independent instances.

## 0.2.0

### Minor Changes

- ee92c50: Initial release of ChatCops packages with AI provider abstraction, server adapters, and embeddable chat widget.
