# @chatcops/core

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
