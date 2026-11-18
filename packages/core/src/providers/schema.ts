import type { JSONSchema, ToolDefinition, ToolParameter } from '../types.js';

/**
 * Names every provider accepts: Claude and OpenAI allow letters, digits, `_`
 * and `-` up to 64 characters, and Gemini also wants a letter or `_` first.
 */
const TOOL_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/;

/** The 0.4 flat parameter form as a JSON Schema object. */
export function legacyParametersToSchema(
  parameters: Record<string, ToolParameter>,
  required: string[] = []
): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  for (const [key, parameter] of Object.entries(parameters)) {
    properties[key] = {
      type: parameter.type,
      description: parameter.description,
      ...(parameter.enum ? { enum: parameter.enum } : {}),
    };
  }
  return { type: 'object', properties, required };
}

/** The JSON Schema sent to providers for this tool's input. */
export function toolInputSchema(tool: ToolDefinition): JSONSchema {
  if (tool.inputSchema) return tool.inputSchema;
  return legacyParametersToSchema(tool.parameters ?? {}, tool.required ?? []);
}

export class ToolDefinitionError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid tool definitions:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ToolDefinitionError';
  }
}

/**
 * Checks tool definitions before any request, so a mistake fails at startup
 * with a clear message instead of as a provider error on the first message.
 * Throws a `ToolDefinitionError` listing every problem.
 */
export function validateTools(tools: readonly ToolDefinition[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  tools.forEach((tool, index) => {
    const label = typeof tool?.name === 'string' && tool.name ? `"${tool.name}"` : `#${index}`;

    if (typeof tool?.name !== 'string' || !TOOL_NAME.test(tool.name)) {
      problems.push(
        `tool ${label}: the name must start with a letter or _, and use only letters, digits, _ and - (64 at most)`
      );
    } else if (seen.has(tool.name)) {
      problems.push(`tool ${label}: another tool has the same name`);
    } else {
      seen.add(tool.name);
    }

    if (typeof tool?.description !== 'string') {
      problems.push(`tool ${label}: description must be a string`);
    }

    if (tool?.inputSchema && tool.parameters) {
      problems.push(`tool ${label}: set inputSchema or parameters, not both`);
    }

    if (tool?.inputSchema) {
      const schema = tool.inputSchema;
      if (typeof schema !== 'object' || schema === null || Array.isArray(schema) || schema.type !== 'object') {
        problems.push(`tool ${label}: inputSchema must be a JSON Schema with type: 'object' at the root`);
      }
      try {
        JSON.stringify(schema);
      } catch {
        problems.push(`tool ${label}: inputSchema must be plain JSON (no cycles or functions)`);
      }
    } else if (tool?.parameters) {
      for (const key of tool.required ?? []) {
        if (!(key in tool.parameters)) {
          problems.push(`tool ${label}: required lists "${key}", which isn't in parameters`);
        }
      }
    }
  });

  if (problems.length > 0) throw new ToolDefinitionError(problems);
}
