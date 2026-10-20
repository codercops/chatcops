import type { Tool as GeminiTool } from '@google/genai';
import type { ChatMessage, ProviderConfig, ToolDefinition } from '../types.js';
import type { AIProvider } from './types.js';
import { toolInputSchema } from './schema.js';

export type { AIProvider } from './types.js';

/** Output token limit used when neither the server config nor the request sets one. */
export const DEFAULT_MAX_TOKENS = 4096;

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

export interface NormalizedMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Turns stored messages into a history every provider accepts: it starts with
 * a user turn and alternates between user and assistant.
 *
 * - System messages and empty messages are dropped.
 * - Leading assistant turns are dropped (history trimming can leave one first).
 * - Consecutive turns with the same role are merged with a blank line, for
 *   example a user message saved before a provider call that then failed.
 */
export function normalizeHistory(messages: ChatMessage[]): NormalizedMessage[] {
  const normalized: NormalizedMessage[] = [];

  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (!message.content.trim()) continue;
    if (normalized.length === 0 && message.role !== 'user') continue;

    const previous = normalized.at(-1);
    if (previous && previous.role === message.role) {
      previous.content += `\n\n${message.content}`;
    } else {
      normalized.push({ role: message.role, content: message.content });
    }
  }

  return normalized;
}

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
