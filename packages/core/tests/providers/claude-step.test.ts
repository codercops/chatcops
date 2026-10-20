import { describe, expect, it } from 'vitest';
import { ClaudeProvider, toClaudeStepMessages } from '../../src/providers/claude.js';
import type { ProviderEvent, ProviderStepParams } from '../../src/providers/types.js';
import type { ChatMessage, MessagePart, ToolCallPart, ToolDefinition } from '../../src/types.js';
import { replayFetch, type ReplayOptions } from '../helpers/replay-fetch.js';

const SYSTEM = 'You are the support assistant for a small online shop. Keep answers short.';
const user = (content: string): ChatMessage => ({ id: 'u1', role: 'user', content, timestamp: 0 });

function provider(name: string, options?: ReplayOptions & { effort?: 'high' }) {
  const replay = replayFetch('claude', name, options);
  const claude = new ClaudeProvider({ type: 'claude', apiKey: 'test-key', fetch: replay.fetch, effort: options?.effort });
  return { claude, replay };
}

async function run(claude: ClaudeProvider, params: ProviderStepParams) {
  const events: ProviderEvent[] = [];
  for await (const event of claude.step(params)) events.push(event);
  const finish = events.at(-1);
  if (finish?.type !== 'finish') throw new Error('step did not end with finish');
  const text = events.flatMap((e) => (e.type === 'text-delta' ? [e.delta] : [])).join('');
  return { events, finish, text };
}

/** The assistant message after a step, with a result for every call. */
function withResults(parts: MessagePart[], data: (call: ToolCallPart) => unknown): ChatMessage {
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

// The same tools the fixtures were recorded with (scripts/record-fixtures.mjs).
const ORDERS_TOOL: ToolDefinition = {
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

const WEATHER_TOOL: ToolDefinition = {
  name: 'get_weather',
  description: 'Current weather for one city.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
};

describe('ClaudeProvider.step with recorded responses', () => {
  it('streams a plain reply and reports why it stopped and what it used', async () => {
    const { claude, replay } = provider('text');
    const { events, finish, text } = await run(claude, { messages: [user('Say hello in five words.')], systemPrompt: SYSTEM });

    expect(replay.requests[0]).toEqual(replay.recordedRequests[0]);
    expect(events.filter((e) => e.type === 'text-delta').length).toBeGreaterThan(0);
    expect(finish.reason).toBe('stop');
    expect(finish.parts).toEqual([{ type: 'text', text }]);
    expect(finish.usage.inputTokens).toBeGreaterThan(0);
    expect(finish.usage.outputTokens).toBeGreaterThan(0);
  });

  it('reports a tool call with nested input and sends the result back on the next step', async () => {
    const { claude, replay } = provider('one-tool');
    const messages = [user('Where is order A-1001? Include tracking. Use the tool.')];
    const first = await run(claude, { messages, systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });

    expect(first.finish.reason).toBe('tool-calls');
    const callEvents = first.events.filter((e) => e.type === 'tool-call');
    expect(callEvents).toHaveLength(1);
    const call = callEvents[0].type === 'tool-call' ? callEvents[0].call : null;
    expect(call?.name).toBe('lookup_orders');
    expect(call?.input).toEqual({ orders: [{ id: 'A-1001', include: ['tracking'] }] });

    const second = await run(claude, {
      messages: [...messages, withResults(first.finish.parts, () => ({ id: 'A-1001', status: 'shipped', tracking: 'ZX123' }))],
      systemPrompt: SYSTEM,
      tools: [ORDERS_TOOL],
    });

    // What went out on the second request is exactly what was recorded live,
    // and the live API accepted it.
    expect(replay.requests[1]).toEqual(replay.recordedRequests[1]);
    expect(second.finish.reason).toBe('stop');
    expect(second.text).toMatch(/ZX123/);
  });

  it('sends thinking blocks back with their signatures in a tool loop', async () => {
    const { claude, replay } = provider('thinking-tool', { effort: 'high' });
    const messages = [user('Orders A-1001 and B-2002 were placed the same day. Look both up, then work out which one reaches me first and why.')];
    const first = await run(claude, { messages, systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });

    const reasoning = first.finish.parts.find((part) => part.type === 'reasoning');
    expect(reasoning?.providerMetadata?.claude?.signature).toEqual(expect.any(String));
    expect(first.events.some((e) => e.type === 'reasoning-delta')).toBe(true);

    await run(claude, {
      messages: [...messages, withResults(first.finish.parts, (call) => ({
        orders: (call.input as { orders: { id: string }[] }).orders.map((order) => ({
          id: order.id,
          status: order.id === 'A-1001' ? 'shipped, arrives Friday' : 'packing, arrives Monday',
        })),
      }))],
      systemPrompt: SYSTEM,
      tools: [ORDERS_TOOL],
    });

    const sent = replay.requests[1].messages as { role: string; content: { type: string; signature?: string }[] }[];
    expect(sent[1].content[0]).toEqual({
      type: 'thinking',
      thinking: (reasoning as { text: string }).text,
      signature: reasoning?.providerMetadata?.claude?.signature,
    });
    expect(replay.requests[1]).toEqual(replay.recordedRequests[1]);
  });

  it('reports parallel tool calls from one step, and sends both results back in order', async () => {
    const { claude, replay } = provider('parallel-tools');
    const messages = [user('What is the weather in Paris and in Tokyo right now? Call the tool for both cities at once.')];
    const first = await run(claude, { messages, systemPrompt: SYSTEM, tools: [WEATHER_TOOL] });

    const calls = first.events.flatMap((e) => (e.type === 'tool-call' ? [e.call] : []));
    expect(calls.map((c) => c.input.city).sort()).toEqual(['Paris', 'Tokyo']);

    await run(claude, {
      messages: [...messages, withResults(first.finish.parts, (call) => ({
        city: (call.input as { city: string }).city,
        tempC: (call.input as { city: string }).city === 'Paris' ? 14 : 19,
      }))],
      systemPrompt: SYSTEM,
      tools: [WEATHER_TOOL],
    });

    const results = (replay.requests[1].messages as { content: { type: string; tool_use_id?: string }[] }[])[2].content;
    expect(results.map((block) => block.tool_use_id)).toEqual(calls.map((c) => c.id));
    expect(replay.requests[1]).toEqual(replay.recordedRequests[1]);
  });

  it('reports a reply cut off by the token limit as length', async () => {
    const { claude } = provider('max-tokens');
    const { finish } = await run(claude, { messages: [user('Write a long poem about the sea.')], systemPrompt: SYSTEM, maxTokens: 16 });
    expect(finish.reason).toBe('length');
  });

  it('reports a refusal as a finish reason instead of throwing', async () => {
    const { claude } = provider('refusal');
    const { finish } = await run(claude, { messages: [user('Say hello in five words.')], systemPrompt: SYSTEM });
    expect(finish.reason).toBe('refusal');
  });

  it('stops when the request is aborted partway through the stream', async () => {
    const { claude } = provider('text', { hangAfterBytes: 600 });
    const controller = new AbortController();
    const step = run(claude, { messages: [user('Say hello in five words.')], systemPrompt: SYSTEM, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(step).rejects.toThrow();
  });
});

describe('toClaudeStepMessages', () => {
  const call = (id: string, input: unknown = {}): ToolCallPart => ({
    type: 'tool-call', toolCallId: id, toolName: 'lookup', input, executor: 'server', state: 'done',
  });

  it('sends plain visitor text as a string, merging turns in a row', () => {
    expect(toClaudeStepMessages([user('one'), { ...user('two'), id: 'u2' }])).toEqual([
      { role: 'user', content: 'one\n\ntwo' },
    ]);
  });

  it('puts tool results before the visitor text when both land in one user turn', () => {
    const messages: ChatMessage[] = [
      user('look it up'),
      {
        id: 'a1', role: 'assistant', content: '', timestamp: 0,
        parts: [call('t1'), { type: 'tool-result', toolCallId: 't1', toolName: 'lookup', output: { success: true } }],
      },
      { ...user('and then?'), id: 'u2' },
    ];
    const out = toClaudeStepMessages(messages);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect((out[2].content as { type: string }[]).map((b) => b.type)).toEqual(['tool_result', 'text']);
  });

  it("drops reasoning that has no Claude signature, and input that isn't an object", () => {
    const out = toClaudeStepMessages([
      user('hi'),
      {
        id: 'a1', role: 'assistant', content: 'ok', timestamp: 0,
        parts: [
          { type: 'reasoning', text: 'from another provider', providerMetadata: { gemini: { thoughtSignature: 'x' } } },
          call('t1', 'not json'),
          { type: 'tool-result', toolCallId: 't1', toolName: 'lookup', error: 'bad input' },
        ],
      },
    ]);
    expect(out[1].content).toEqual([{ type: 'tool_use', id: 't1', name: 'lookup', input: {} }]);
    expect(out[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: '{"success":false,"message":"bad input"}', is_error: true },
    ]);
  });

  it('sends redacted thinking back as redacted_thinking', () => {
    const out = toClaudeStepMessages([
      user('hi'),
      {
        id: 'a1', role: 'assistant', content: 'ok', timestamp: 0,
        parts: [
          { type: 'reasoning', text: '', providerMetadata: { claude: { redactedData: 'opaque' } } },
          { type: 'text', text: 'ok' },
        ],
      },
    ]);
    expect(out[1].content).toEqual([{ type: 'redacted_thinking', data: 'opaque' }, { type: 'text', text: 'ok' }]);
  });
});
