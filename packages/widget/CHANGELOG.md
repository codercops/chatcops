# @chatcops/widget

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
