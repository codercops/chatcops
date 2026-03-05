import { SchemaType, type Tool, type FunctionDeclaration } from '@google/generative-ai';
import type { ChatMessage, ProviderChatParams, ProviderConfig, ToolDefinition } from '../types.js';

export interface AIProvider {
  name: string;
  chat(params: ProviderChatParams): AsyncGenerator<string>;
  chatSync(params: ProviderChatParams): Promise<string>;
}

export async function createProvider(config: ProviderConfig): Promise<AIProvider> {
  switch (config.type) {
    case 'claude': {
      const { ClaudeProvider } = await import('./claude.js');
      return new ClaudeProvider(config);
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(config);
    }
    case 'gemini': {
      const { GeminiProvider } = await import('./gemini.js');
      return new GeminiProvider(config);
    }
    default:
      throw new Error(`Unknown provider type: ${(config as ProviderConfig).type}`);
  }
}

export function toProviderMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
}

export function toClaudeTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      properties: t.parameters,
      required: t.required,
    },
  }));
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object' as const,
        properties: t.parameters,
        required: t.required,
      },
    },
  }));
}

const SCHEMA_TYPE_MAP: Record<string, SchemaType> = {
  string: SchemaType.STRING,
  number: SchemaType.NUMBER,
  boolean: SchemaType.BOOLEAN,
};

export function toGeminiTools(tools: ToolDefinition[]): Tool[] {
  return [{
    functionDeclarations: tools.map((t): FunctionDeclaration => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, {
            type: SCHEMA_TYPE_MAP[v.type] ?? SchemaType.STRING,
            description: v.description,
            ...(v.enum ? { enum: v.enum } : {}),
          }])
        ),
        required: t.required,
      },
    })),
  }];
}
