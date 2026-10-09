# @chatcops/server

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
