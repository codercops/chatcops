---
"@chatcops/core": minor
"@chatcops/server": minor
---

Tools can describe their input with a full JSON Schema in `inputSchema`: nested objects, arrays, `enum`, `anyOf` and `$ref` all go to Claude, OpenAI and Gemini as written. The flat `parameters` form from 0.4 still works and is converted to the same schema.

- `execute(input, context)` now gets a second argument with the `conversationId` and an `AbortSignal` that fires when the visitor leaves. Tools that ignore it keep working.
- Tools can carry `annotations` (`title`, `readOnlyHint`, `destructiveHint`).
- The server checks tool definitions when it starts and throws a `ToolDefinitionError` that lists every problem: an invalid or duplicate name, an `inputSchema` whose root isn't `type: 'object'`, both `inputSchema` and `parameters` set, or a `required` key that isn't in `parameters`. Before, these failed as a provider error on the first message.
- New exports: `toolInputSchema`, `legacyParametersToSchema`, `validateTools`, `ToolDefinitionError`, and the `ToolContext` and `ToolAnnotations` types. `ToolDefinition.parameters` and `required` are now optional.
