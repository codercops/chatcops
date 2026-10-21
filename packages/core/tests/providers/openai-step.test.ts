import { describe, expect, it, vi } from 'vitest';
import { OpenAIProvider, toOpenAIStepMessages } from '../../src/providers/openai.js';
import type { ChatMessage, ToolCallPart } from '../../src/types.js';
import { replayFetch, type ReplayOptions } from '../helpers/replay-fetch.js';
import {
  ORDERS_TOOL,
  orderResult,
  PROMPTS,
  run,
  SYSTEM,
  user,
  WEATHER_TOOL,
  weatherResult,
  withResults,
} from '../helpers/step.js';

function provider(name: string, options?: ReplayOptions) {
  const replay = replayFetch('openai', name, options);
  const openai = new OpenAIProvider({ type: 'openai', apiKey: 'test-key', fetch: replay.fetch });
  return { openai, replay };
}

/** An SSE body from chat completion chunks, for cases that can't be recorded. */
function sse(chunks: unknown[]): Response {
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) => ({
  id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason }],
});

describe('OpenAIProvider.step with recorded responses', () => {
  it('streams a plain reply and reads usage from the last chunk', async () => {
    const { openai, replay } = provider('text');
    const { finish, text } = await run(openai, { messages: [user(PROMPTS.text)], systemPrompt: SYSTEM });

    expect(replay.requests[0]).toEqual(replay.recordedRequests[0]);
    expect(replay.requests[0].stream_options).toEqual({ include_usage: true });
    expect(finish.reason).toBe('stop');
    expect(finish.parts).toEqual([{ type: 'text', text }]);
    expect(finish.usage.inputTokens).toBeGreaterThan(0);
    expect(finish.usage.outputTokens).toBeGreaterThan(0);
  });

  it('reports a tool call with nested input and sends the result back on the next step', async () => {
    const { openai, replay } = provider('one-tool');
    const messages = [user(PROMPTS.oneTool)];
    const first = await run(openai, { messages, systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });

    expect(first.finish.reason).toBe('tool-calls');
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0].name).toBe('lookup_orders');
    const orders = (first.calls[0].input as { orders: { id: string; include: string[] }[] }).orders;
    expect(orders).toHaveLength(1);
    expect(orders[0].id).toBe('A-1001');
    expect(orders[0].include).toContain('tracking');
    expect(first.calls[0].id).toMatch(/^call_/);

    const second = await run(openai, {
      messages: [...messages, withResults(first.finish.parts, orderResult)],
      systemPrompt: SYSTEM,
      tools: [ORDERS_TOOL],
    });
    expect(replay.requests[1]).toEqual(replay.recordedRequests[1]);
    expect(second.finish.reason).toBe('stop');
    expect(second.text).toMatch(/ZX123/);
  });

  it('reports parallel calls in one step, and sends one tool message per call in call order', async () => {
    const { openai, replay } = provider('parallel-tools');
    const messages = [user(PROMPTS.parallel)];
    const first = await run(openai, { messages, systemPrompt: SYSTEM, tools: [WEATHER_TOOL] });
    expect(first.calls.map((c) => c.input.city).sort()).toEqual(['Paris', 'Tokyo']);

    await run(openai, {
      messages: [...messages, withResults(first.finish.parts, weatherResult)],
      systemPrompt: SYSTEM,
      tools: [WEATHER_TOOL],
    });
    const sent = replay.requests[1].messages as { role: string; tool_call_id?: string }[];
    expect(sent.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(first.calls.map((c) => c.id));
    expect(replay.requests[1]).toEqual(replay.recordedRequests[1]);
  });

  it('reports a reply cut off by the token limit as length', async () => {
    const { openai } = provider('max-tokens');
    const { finish } = await run(openai, { messages: [user(PROMPTS.maxTokens)], systemPrompt: SYSTEM, maxTokens: 16 });
    expect(finish.reason).toBe('length');
  });

  it('reports a refusal, keeping its text for the visitor', async () => {
    const { openai } = provider('refusal');
    const { finish } = await run(openai, { messages: [user(PROMPTS.text)], systemPrompt: SYSTEM });
    expect(finish.reason).toBe('refusal');
    expect(finish.parts[0]).toMatchObject({ type: 'text' });
  });

  it('reports a content filter stop', async () => {
    const { openai } = provider('content-filter');
    const { finish } = await run(openai, { messages: [user(PROMPTS.text)], systemPrompt: SYSTEM });
    expect(finish.reason).toBe('content-filter');
  });

  it('stops when the request is aborted partway through the stream', async () => {
    const { openai } = provider('text', { hangAfterBytes: 400 });
    const controller = new AbortController();
    const step = run(openai, { messages: [user(PROMPTS.text)], systemPrompt: SYSTEM, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(step).rejects.toThrow();
  });
});

describe('OpenAIProvider.step edge cases', () => {
  it('retries once without stream_options when the server rejects it, and stops asking', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bodies: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      bodies.push(body);
      if (body.stream_options) {
        return new Response(JSON.stringify({ error: { message: 'Unrecognized request argument supplied: stream_options', type: 'invalid_request_error' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }
      return sse([chunk({ content: 'Hi' }), chunk({}, 'stop')]);
    });
    const openai = new OpenAIProvider({ type: 'openai', apiKey: 'test-key', baseURL: 'http://localhost:11434/v1', fetch });

    const first = await run(openai, { messages: [user('hi')], systemPrompt: SYSTEM });
    await run(openai, { messages: [user('hi')], systemPrompt: SYSTEM });

    expect(first.text).toBe('Hi');
    expect(bodies.map((b) => 'stream_options' in b)).toEqual([true, false, false]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("marks a call whose arguments aren't JSON instead of running it", async () => {
    const fetch = vi.fn(async () => sse([
      chunk({ tool_calls: [{ index: 0, id: 'call_bad', type: 'function', function: { name: 'lookup_orders', arguments: '{"orders": [' } }] }),
      chunk({}, 'tool_calls'),
    ]));
    const openai = new OpenAIProvider({ type: 'openai', apiKey: 'test-key', fetch });
    const { events, finish } = await run(openai, { messages: [user('hi')], systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });

    const call = events.find((e) => e.type === 'tool-call');
    expect(call).toMatchObject({ type: 'tool-call', call: { id: 'call_bad', input: {} }, inputError: expect.stringMatching(/JSON/) });
    expect(finish.parts).toEqual([
      { type: 'tool-call', toolCallId: 'call_bad', toolName: 'lookup_orders', input: '{"orders": [', executor: 'server', state: 'error' },
    ]);
  });

  it('counts a step that ends with stop but has calls as a tool step (Ollama does this)', async () => {
    const fetch = vi.fn(async () => sse([
      chunk({ tool_calls: [{ index: 0, function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] }),
      chunk({}, 'stop'),
    ]));
    const openai = new OpenAIProvider({ type: 'openai', apiKey: 'test-key', baseURL: 'http://localhost:11434/v1', fetch });
    const { finish, calls } = await run(openai, { messages: [user('hi')], systemPrompt: SYSTEM, tools: [WEATHER_TOOL] });
    expect(finish.reason).toBe('tool-calls');
    expect(calls[0].id).toMatch(/^call_[0-9a-f-]{36}$/);
  });
});

describe('toOpenAIStepMessages', () => {
  const call = (id: string, input: unknown): ToolCallPart => ({
    type: 'tool-call', toolCallId: id, toolName: 'lookup', input, executor: 'server', state: 'done',
  });

  it('sends each step as an assistant message with tool_calls, then the tool messages', () => {
    const messages: ChatMessage[] = [
      user('look it up'),
      {
        id: 'a1', role: 'assistant', content: 'Done.', timestamp: 0,
        parts: [
          { type: 'reasoning', text: 'not sent back' },
          { type: 'text', text: 'Checking.' },
          call('t1', { id: 1 }),
          { type: 'tool-result', toolCallId: 't1', toolName: 'lookup', output: { success: true } },
          { type: 'text', text: 'Done.' },
        ],
      },
    ];
    expect(toOpenAIStepMessages('sys', messages)).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'look it up' },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 'lookup', arguments: '{"id":1}' } }],
      },
      { role: 'tool', tool_call_id: 't1', content: '{"success":true}' },
      { role: 'assistant', content: 'Done.' },
    ]);
  });

  it('sends malformed arguments back as the model wrote them, with the error as the result', () => {
    const out = toOpenAIStepMessages('sys', [
      user('hi'),
      {
        id: 'a1', role: 'assistant', content: '', timestamp: 0,
        parts: [call('t1', '{"orders": ['), { type: 'tool-result', toolCallId: 't1', toolName: 'lookup', error: 'Tool arguments must be valid JSON.' }],
      },
    ]);
    expect(out[2]).toMatchObject({ content: null, tool_calls: [{ function: { arguments: '{"orders": [' } }] });
    expect(out[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: '{"success":false,"message":"Tool arguments must be valid JSON."}' });
  });
});
