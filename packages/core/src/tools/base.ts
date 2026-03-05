import type { ToolParameter, ToolResult, ToolDefinition } from '../types.js';

export interface ChatTool {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  required: string[];
  execute(input: Record<string, unknown>): Promise<ToolResult>;
}

export function toolToDefinition(tool: ChatTool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    required: tool.required,
  };
}
