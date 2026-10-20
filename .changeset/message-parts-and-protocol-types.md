---
"@chatcops/core": minor
---

Add the types the next releases build on, with no change in behavior yet:

- `ChatMessage` can carry `parts` (text, reasoning, sources, tool calls and results, captured leads, handoff), a `status` (`complete`, `incomplete`, `aborted`), `usage` and `aiGenerated`. `Conversation` can carry a `version`. All of them are optional, so stores written for 0.4 keep working. `partsOf(message)` reads the parts of any message, treating `content` as one text part for messages saved without them, and `messageText(parts)` joins the text parts.
- `ProviderEvent`, `ProviderStepParams` and an optional `step()` on `AIProvider`, for providers that run one model request at a time.
- Wire protocol v1 types (`WirePart`, `ChatRequestV1`, `WireErrorCode`, `WireErrorBody`) and `PROTOCOL_VERSION`.
- The built-in providers now expose their `model` as a read-only property.
