import type {
  JSONSchema,
  MessagePart,
  ToolAnnotations,
  ToolContext,
  ToolDefinition,
  ToolParameter,
  ToolResult,
} from '../types.js';

export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema for the input (root `type: 'object'`). Preferred over `parameters`. */
  inputSchema?: JSONSchema;
  /** The 0.4 flat form, used when there's no `inputSchema`. */
  parameters?: Record<string, ToolParameter>;
  required?: string[];
  annotations?: ToolAnnotations;
  /** `context` is new in 0.6; tools written for 0.4 can ignore it. */
  execute(input: Record<string, unknown>, context?: ToolContext): Promise<ToolResult>;
  /**
   * Parts to add to the reply after this tool runs, for things the widget
   * shows besides text. `LeadCaptureTool` adds a `lead-captured` part.
   */
  emits?(result: ToolResult): MessagePart[];
}

export function toolToDefinition(tool: ChatTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
    ...(tool.parameters ? { parameters: tool.parameters } : {}),
    ...(tool.required ? { required: tool.required } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}
