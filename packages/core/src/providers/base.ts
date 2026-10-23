import type { Tool as GeminiTool } from '@google/genai';
import type { ChatMessage, ProviderConfig, ToolDefinition } from '../types.js';
import type { AIProvider } from './types.js';
import { toolInputSchema } from './schema.js';
import { getProviderFactory } from './registry.js';

export type { AIProvider } from './types.js';

/** Output token limit used when neither the server config nor the request sets one. */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * True for a provider object, false for a provider config. A config never
 * has functions, so an object with a `step` or `chat` function is a provider.
 */
export function isAIProvider(value: unknown): value is AIProvider {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AIProvider>;
  return typeof candidate.step === 'function' || typeof candidate.chat === 'function';
}

export async function createProvider(config: ProviderConfig): Promise<AIProvider> {
  const factory = getProviderFactory(config.type);
  if (factory) return factory(config);

  switch (config.type) {
    case 'claude': {
      const { ClaudeProvider } = await import('./claude.js');
      return new ClaudeProvider(config);
    }
    case 'openai': {
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(config);
    }
    case 'openai-compatible': {
      const { OpenAIProvider } = await import('./openai.js');
      return new OpenAIProvider(config, { compatible: true });
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

export {
  normalizeHistory,
  normalizeTurns,
  trimHistory,
  estimateTokens,
  type NormalizedMessage,
  type NormalizedTurn,
  type TurnPart,
} from './history.js';

const warned = new Set<string>();

/** Logs a configuration warning once per process. */
export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[chatcops] ${message}`);
}

export function toClaudeTools(tools: ToolDefinition[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: toolInputSchema(t) as { type: 'object'; [key: string]: unknown },
  }));
}

export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map((t) => {
    const schema = toolInputSchema(t);
    return {
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        // OpenAI rejects an object schema without `properties`.
        parameters: 'properties' in schema ? schema : { ...schema, properties: {} },
      },
    };
  });
}

export function toGeminiTools(tools: ToolDefinition[]): GeminiTool[] {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parametersJsonSchema: toolInputSchema(t),
    })),
  }];
}
