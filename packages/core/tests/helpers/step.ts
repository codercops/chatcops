import type { AIProvider } from '../../src/providers/base.js';
import type { ProviderEvent, ProviderStepParams } from '../../src/providers/types.js';
import type { ChatMessage, MessagePart, ToolCallPart, ToolDefinition } from '../../src/types.js';

// The prompts and tools the fixtures were recorded with (scripts/record-fixtures.mjs).
export const SYSTEM = 'You are the support assistant for a small online shop. Keep answers short.';

export const user = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content, timestamp: 0 });

export const ORDERS_TOOL: ToolDefinition = {
  name: 'lookup_orders',
  description: 'Look up one or more orders by id. Can include line items and tracking.',
  inputSchema: {
    type: 'object',
    properties: {
      orders: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            include: { type: 'array', items: { type: 'string', enum: ['items', 'tracking'] } },
          },
          required: ['id'],
        },
      },
    },
    required: ['orders'],
  },
};

export const WEATHER_TOOL: ToolDefinition = {
  name: 'get_weather',
  description: 'Current weather for one city.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

export const PROMPTS = {
  text: 'Say hello in five words.',
  oneTool: 'Where is order A-1001? Include tracking. Use the tool.',
  parallel: 'What is the weather in Paris and in Tokyo right now? Call the tool for both cities at once.',
  maxTokens: 'Write a long poem about the sea.',
};

/** Runs one step and collects what it yielded. */
export async function run(provider: Required<Pick<AIProvider, 'step'>>, params: ProviderStepParams) {
  const events: ProviderEvent[] = [];
  for await (const event of provider.step(params)) events.push(event);
  const finish = events.at(-1);
  if (finish?.type !== 'finish') throw new Error('step did not end with finish');
  const text = events.flatMap((e) => (e.type === 'text-delta' ? [e.delta] : [])).join('');
  const calls = events.flatMap((e) => (e.type === 'tool-call' ? [e.call] : []));
  return { events, finish, text, calls };
}

/** The assistant message after a step, with a result for every call, as runTurn stores it. */
export function withResults(parts: MessagePart[], data: (call: ToolCallPart) => unknown): ChatMessage {
  const calls = parts.filter((part): part is ToolCallPart => part.type === 'tool-call');
  return {
    id: 'a1',
    role: 'assistant',
    content: '',
    timestamp: 0,
    parts: [
      ...parts,
      ...calls.map((call) => ({
        type: 'tool-result' as const,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: { success: true, data: data(call) },
      })),
    ],
  };
}

export const orderResult = () => ({ id: 'A-1001', status: 'shipped', tracking: 'ZX123' });
export const weatherResult = (call: ToolCallPart) => {
  const city = (call.input as { city: string }).city;
  return { city, tempC: city === 'Paris' ? 14 : 19 };
};

/** The long system prompt of the prompt-cache case. */
export const LONG_POLICY = Array.from({ length: 120 }, (_, i) =>
  `Policy ${i + 1}: orders placed before 2pm ship the same day, returns are free within 30 days, and support answers within one business day. Rule ${i + 1} applies to region ${i % 7}.`
).join('\n');
