import { describe, expect, it } from 'vitest';
import { GeminiProvider, toGeminiStepContents } from '../../src/providers/gemini.js';
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
  const replay = replayFetch('gemini', name, options);
  const gemini = new GeminiProvider({ type: 'gemini', apiKey: 'test-key', fetch: replay.fetch });
  return { gemini, replay };
}

describe('GeminiProvider.step with recorded responses', () => {
  it('streams a plain reply and reports usage', async () => {
    const { gemini, replay } = provider('text');
    const { finish, text } = await run(gemini, { messages: [user(PROMPTS.text)], systemPrompt: SYSTEM });

    expect(replay.requests[0]).toEqual(replay.recordedRequests[0]);
    expect(finish.reason).toBe('stop');
    expect(text.length).toBeGreaterThan(0);
    expect(finish.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('')).toBe(text);
    expect(finish.usage.inputTokens).toBeGreaterThan(0);
    expect(finish.usage.outputTokens).toBeGreaterThan(0);
  });

  it('keeps the thought signature on a function call and sends it back on the next step', async () => {
    const { gemini, replay } = provider('one-tool');
    const messages = [user(PROMPTS.oneTool)];
    const first = await run(gemini, { messages, systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });

    expect(first.finish.reason).toBe('tool-calls');
    expect(first.calls).toHaveLength(1);
    const orders = (first.calls[0].input as { orders: { id: string; include?: string[] }[] }).orders;
    expect(orders[0].id).toBe('A-1001');
    const call = first.finish.parts.find((p): p is ToolCallPart => p.type === 'tool-call');
    expect(call?.providerMetadata?.gemini?.thoughtSignature).toEqual(expect.any(String));

    const second = await run(gemini, {
      messages: [...messages, withResults(first.finish.parts, orderResult)],
      systemPrompt: SYSTEM,
      tools: [ORDERS_TOOL],
    });
    expect(replay.requests[1]).toEqual(replay.recordedRequests[1]);
    expect(second.finish.reason).toBe('stop');
    expect(second.text).toMatch(/ZX123/);
  });

  it('reports parallel calls from one step and answers each by id', async () => {
    const { gemini, replay } = provider('parallel-tools');
    const messages = [user(PROMPTS.parallel)];
    const first = await run(gemini, { messages, systemPrompt: SYSTEM, tools: [WEATHER_TOOL] });
    expect(first.calls.map((c) => c.input.city).sort()).toEqual(['Paris', 'Tokyo']);

    await run(gemini, {
      messages: [...messages, withResults(first.finish.parts, weatherResult)],
      systemPrompt: SYSTEM,
      tools: [WEATHER_TOOL],
    });
    expect(replay.requests[1]).toEqual(replay.recordedRequests[1]);
  });

  it('sends per-request context after the system prompt', async () => {
    const { gemini, replay } = provider('text');
    await run(gemini, { messages: [user(PROMPTS.text)], systemPrompt: SYSTEM, systemContext: 'Reply in German.' });
    expect(JSON.stringify(replay.requests[0].systemInstruction)).toContain('Reply in German.');
  });

  it('reports a reply cut off by the token limit as length', async () => {
    const { gemini } = provider('max-tokens');
    const { finish } = await run(gemini, { messages: [user(PROMPTS.maxTokens)], systemPrompt: SYSTEM, maxTokens: 16 });
    expect(finish.reason).toBe('length');
  });

  it('reports a safety stop as content-filter', async () => {
    const { gemini } = provider('content-filter');
    const { finish } = await run(gemini, { messages: [user(PROMPTS.text)], systemPrompt: SYSTEM });
    expect(finish.reason).toBe('content-filter');
  });

  it("makes up an id when the API sends none, and doesn't send that id back", async () => {
    const { gemini } = provider('no-call-id');
    const first = await run(gemini, { messages: [user(PROMPTS.oneTool)], systemPrompt: SYSTEM, tools: [ORDERS_TOOL] });
    expect(first.calls[0].id).toMatch(/^gemini_call_[0-9a-f-]{36}$/);

    const contents = toGeminiStepContents([user(PROMPTS.oneTool), withResults(first.finish.parts, orderResult)]);
    expect(contents[1].parts?.[0].functionCall).not.toHaveProperty('id');
    expect(contents[2].parts?.[0].functionResponse).not.toHaveProperty('id');
  });

  it('stops when the request is aborted partway through the stream', async () => {
    const { gemini } = provider('text', { hangAfterBytes: 200 });
    const controller = new AbortController();
    const step = run(gemini, { messages: [user(PROMPTS.text)], systemPrompt: SYSTEM, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(step).rejects.toThrow();
  });
});

describe('toGeminiStepContents', () => {
  const call = (id: string, meta?: Record<string, unknown>): ToolCallPart => ({
    type: 'tool-call', toolCallId: id, toolName: 'lookup', input: { id }, executor: 'server', state: 'done',
    ...(meta ? { providerMetadata: { gemini: meta } } : {}),
  });
  const result = (id: string) => ({ type: 'tool-result' as const, toolCallId: id, toolName: 'lookup', output: { success: true } });

  it('gives the first call of a step from another provider the placeholder signature on Gemini 3', () => {
    const messages: ChatMessage[] = [
      user('look both up'),
      { id: 'a1', role: 'assistant', content: '', timestamp: 0, parts: [call('t1'), call('t2'), result('t1'), result('t2')] },
    ];
    const contents = toGeminiStepContents(messages, 'gemini-3.5-flash-lite');
    expect(contents[1].parts?.map((p) => p.thoughtSignature)).toEqual(['skip_thought_signature_validator', undefined]);
    expect(toGeminiStepContents(messages, 'gemini-2.5-flash')[1].parts?.[0].thoughtSignature).toBeUndefined();
  });

  it('keeps real signatures, drops reasoning from other providers, and merges the results with the next message', () => {
    const contents = toGeminiStepContents([
      user('hi'),
      {
        id: 'a1', role: 'assistant', content: '', timestamp: 0,
        parts: [
          { type: 'reasoning', text: 'claude thoughts', providerMetadata: { claude: { signature: 'c' } } },
          call('t1', { thoughtSignature: 'sig' }),
          result('t1'),
        ],
      },
      { ...user('thanks'), id: 'u2' },
    ]);
    expect(contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ functionCall: { id: 't1', name: 'lookup', args: { id: 't1' } }, thoughtSignature: 'sig' }] },
      { role: 'user', parts: [{ functionResponse: { id: 't1', name: 'lookup', response: { success: true } } }, { text: 'thanks' }] },
    ]);
  });

  it('still refuses a history with no user message', () => {
    expect(() => toGeminiStepContents([])).toThrow('Cannot send a request with no user message.');
  });
});
