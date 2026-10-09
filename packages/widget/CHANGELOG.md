# @chatcops/widget

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
