import { describe, expect, it, vi } from 'vitest';
import { MaxStepsError, RefusalError } from '../../src/agent/errors.js';
import { runTurn, type RunTurnOptions, type TurnResult } from '../../src/agent/run-turn.js';
import { toolRegistry } from '../../src/agent/tool-registry.js';
import type { WirePart } from '../../src/protocol/v1.js';
import type { AIProvider } from '../../src/providers/types.js';
import { scriptedProvider, textStep, toolStep } from '../../src/testing/provider.js';
import type { ChatTool } from '../../src/tools/base.js';
import { LeadCaptureTool } from '../../src/tools/lead-capture.js';
import type { ChatMessage, MessagePart, ToolContext } from '../../src/types.js';

const user: ChatMessage = { id: 'u1', role: 'user', content: 'Where is my order?', timestamp: 0 };

async function drain(options: Partial<RunTurnOptions> & Pick<RunTurnOptions, 'provider'>) {
  const persisted: { message: ChatMessage; final: boolean }[] = [];
  const turn = runTurn({
    messages: [user],
    systemPrompt: 'Be brief.',
    conversationId: 'c1',
    messageId: 'm1',
    onPersist: (message, { final }) => {
      persisted.push({ message: structuredClone(message), final });
    },
    ...options,
  });
  const parts: WirePart[] = [];
  let next = await turn.next();
  while (!next.done) {
    parts.push(next.value);
    next = await turn.next();
  }
  return { parts, result: next.value as TurnResult, persisted, types: parts.map((p) => p.type) };
}

function tool(name: string, run: (input: Record<string, unknown>, ctx?: ToolContext) => Promise<unknown>): ChatTool {
  return {
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    execute: async (input, ctx) => ({ success: true, data: await run(input, ctx) }),
  };
}

describe('runTurn', () => {
  it('streams a plain reply and saves it once, complete', async () => {
    const { parts, result, persisted, types } = await drain({ provider: scriptedProvider([textStep('Hello there, friend.')]) });

    expect(types).toEqual(['start', 'text-start', 'text-delta', 'text-delta', 'text-delta', 'text-end', 'finish']);
    expect(parts[0]).toEqual({ type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm1' });
    expect(parts.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
    expect(result.status).toBe('complete');
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      final: true,
      message: { id: 'm1', role: 'assistant', content: 'Hello there, friend.', status: 'complete', aiGenerated: true, usage: { inputTokens: 10, outputTokens: 5 } },
    });
  });

  it('runs a tool, saves after the round, and sends the growing reply on the next step', async () => {
    const provider = scriptedProvider([
      toolStep([{ id: 't1', name: 'lookup_order', input: { id: 'A-1' } }], { text: 'Checking. ' }),
      textStep('It shipped.'),
    ]);
    const lookup = vi.fn(async () => ({ status: 'shipped' }));
    const { types, result, persisted } = await drain({ provider, tools: toolRegistry([tool('lookup_order', lookup)]) });

    expect(types).toEqual([
      'start', 'text-start', 'text-delta', 'text-end', 'tool-call', 'tool-result',
      'text-start', 'text-delta', 'text-delta', 'text-end', 'finish',
    ]);
    expect(lookup).toHaveBeenCalledWith({ id: 'A-1' }, expect.objectContaining({ conversationId: 'c1', signal: expect.any(AbortSignal) }));
    expect(persisted.map((p) => [p.final, p.message.status])).toEqual([[false, 'incomplete'], [true, 'complete']]);
    expect(result.message.parts?.map((p) => p.type)).toEqual(['text', 'tool-call', 'tool-result', 'text']);
    expect(result.message.parts?.[1]).toMatchObject({ state: 'done' });
    expect(result.message.parts?.[2]).toEqual({
      type: 'tool-result', toolCallId: 't1', toolName: 'lookup_order', output: { success: true, data: { status: 'shipped' } },
    });
    expect(result.message.content).toBe('Checking. It shipped.');
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });

    // The second step saw the visitor's message and the reply so far.
    const second = provider.calls[1].messages;
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(second[1].parts?.map((p) => p.type)).toEqual(['text', 'tool-call', 'tool-result']);
  });

  it('runs the calls of one step at once and keeps the results in call order', async () => {
    let running = 0;
    let most = 0;
    const slow = (ms: number) => async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return { ms };
    };
    const provider = scriptedProvider([
      toolStep([{ id: 'a', name: 'slow' }, { id: 'b', name: 'fast' }]),
      textStep('Both done.'),
    ]);
    const { result } = await drain({ provider, tools: toolRegistry([tool('slow', slow(20)), tool('fast', slow(1))]) });

    expect(most).toBe(2);
    const results = result.message.parts?.filter((p) => p.type === 'tool-result').map((p) => (p as { toolCallId: string }).toolCallId);
    expect(results).toEqual(['a', 'b']);
  });

  it('adds the parts a tool emits, like a captured lead, and reports them', async () => {
    const provider = scriptedProvider([
      toolStep([{ name: 'capture_lead', input: { name: 'Ada', email: 'ada@example.com', projectDetails: 'A site' } }]),
      textStep('Thanks, Ada.'),
    ]);
    const onPart = vi.fn();
    const { parts, result } = await drain({ provider, tools: toolRegistry([new LeadCaptureTool()]), onPart });

    const lead = parts.find((p) => p.type === 'lead-captured');
    expect(lead).toMatchObject({ lead: { name: 'Ada', email: 'ada@example.com' } });
    expect(result.message.parts?.map((p) => p.type)).toEqual(['tool-call', 'tool-result', 'lead-captured', 'text']);
    expect(onPart.mock.calls.map(([part]: [MessagePart]) => part.type)).toEqual(['tool-call', 'tool-result', 'lead-captured']);
  });

  it('still reports a lead from a plain capture_lead tool written for 0.4', async () => {
    const provider = scriptedProvider([toolStep([{ name: 'capture_lead', input: {} }]), textStep('Noted.')]);
    const { parts } = await drain({ provider, tools: toolRegistry([tool('capture_lead', async () => ({ email: 'x@example.com' }))]) });
    expect(parts.find((p) => p.type === 'lead-captured')).toEqual({ type: 'lead-captured', lead: { email: 'x@example.com' } });
  });

  it("stops at the step limit without running the last round's calls", async () => {
    const provider = scriptedProvider(Array.from({ length: 5 }, () => toolStep([{ name: 'again' }])));
    const again = vi.fn(async () => ({}));
    const { parts, result } = await drain({ provider, tools: toolRegistry([tool('again', again)]), maxSteps: 3 });

    expect(again).toHaveBeenCalledTimes(2);
    expect(provider.calls).toHaveLength(3);
    expect(result.status).toBe('incomplete');
    expect(result.error).toBeInstanceOf(MaxStepsError);
    expect((result.error as Error).message).toBe('Exceeded maximum tool rounds (2).');
    expect(parts.slice(-2)).toEqual([
      { type: 'error', code: 'tool_error', retryable: false },
      { type: 'finish', reason: 'error' },
    ]);
    expect(result.message.parts?.at(-1)).toMatchObject({ type: 'tool-result', error: 'Not run: the reply reached its tool round limit.' });
  });

  it("answers a call whose input isn't JSON with the error instead of running it", async () => {
    const provider = scriptedProvider([
      [
        { type: 'tool-call', call: { id: 'bad', name: 'lookup_order', input: {} }, inputError: 'Tool arguments must be valid JSON.' },
        { type: 'finish', reason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1 }, parts: [
          { type: 'tool-call', toolCallId: 'bad', toolName: 'lookup_order', input: '{"id', executor: 'server', state: 'error' },
        ] },
      ],
      textStep('Sorry.'),
    ]);
    const lookup = vi.fn(async () => ({}));
    const { result } = await drain({ provider, tools: toolRegistry([tool('lookup_order', lookup)]) });

    expect(lookup).not.toHaveBeenCalled();
    expect(result.message.parts?.[1]).toMatchObject({ type: 'tool-result', error: 'Tool arguments must be valid JSON.' });
  });

  it('ends as aborted when the visitor leaves during a tool call, and the tool sees the abort', async () => {
    const controller = new AbortController();
    let toolSignal: AbortSignal | undefined;
    const provider = scriptedProvider([toolStep([{ name: 'wait' }]), textStep('never sent')]);
    const waiting = tool('wait', async (_input, ctx) => {
      toolSignal = ctx?.signal;
      controller.abort();
      return {};
    });
    const { result, persisted, parts } = await drain({ provider, tools: toolRegistry([waiting]), signal: controller.signal });

    expect(toolSignal?.aborted).toBe(true);
    expect(provider.calls).toHaveLength(1);
    expect(result.status).toBe('aborted');
    expect(parts.at(-1)).toEqual({ type: 'finish', reason: 'aborted' });
    expect(persisted.at(-1)).toMatchObject({ final: true, message: { status: 'aborted' } });
  });

  it('ends as aborted when the visitor leaves while the model is writing', async () => {
    const controller = new AbortController();
    const provider = scriptedProvider(['hang']);
    setTimeout(() => controller.abort(), 10);
    const { result, parts } = await drain({ provider, signal: controller.signal });
    expect(result.status).toBe('aborted');
    expect(parts.map((p) => p.type)).toEqual(['start', 'finish']);
  });

  it('reports a provider error as an error part, and keeps the error for the caller', async () => {
    const boom = new Error('upstream 500');
    const { parts, result } = await drain({ provider: scriptedProvider([boom]) });
    expect(parts.slice(1)).toEqual([
      { type: 'error', code: 'provider_error', retryable: true },
      { type: 'finish', reason: 'error' },
    ]);
    expect(result).toMatchObject({ status: 'incomplete', error: boom });
  });

  it("doesn't keep a refused step", async () => {
    const provider = scriptedProvider([[
      { type: 'text-delta', delta: 'I cannot' },
      { type: 'finish', reason: 'refusal', usage: { inputTokens: 1, outputTokens: 1 }, parts: [{ type: 'text', text: 'I cannot' }] },
    ]]);
    const { parts, result } = await drain({ provider });
    expect(parts.slice(-2)).toEqual([
      { type: 'error', code: 'content_filtered', retryable: false },
      { type: 'finish', reason: 'error' },
    ]);
    expect(result.error).toBeInstanceOf(RefusalError);
    expect(result.message.parts).toEqual([]);
  });

  it('ends a reply cut off by the token limit as length, incomplete', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = scriptedProvider([[
      { type: 'text-delta', delta: 'Once upon' },
      { type: 'finish', reason: 'length', usage: { inputTokens: 1, outputTokens: 16 }, parts: [{ type: 'text', text: 'Once upon' }] },
    ]]);
    const { parts, result } = await drain({ provider });
    expect(parts.at(-1)).toEqual({ type: 'finish', reason: 'length' });
    expect(result.status).toBe('incomplete');
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('times out a slow tool and aborts its signal', async () => {
    let toolSignal: AbortSignal | undefined;
    const provider = scriptedProvider([toolStep([{ name: 'slow' }]), textStep('It took too long.')]);
    const slow = tool('slow', (_input, ctx) => {
      toolSignal = ctx?.signal;
      return new Promise(() => {});
    });
    const { result } = await drain({ provider, tools: toolRegistry([slow]), toolTimeoutMs: 10 });

    expect(toolSignal?.aborted).toBe(true);
    expect(result.message.parts?.[1]).toMatchObject({ type: 'tool-result', error: 'Tool execution timed out after 10ms.' });
    expect(result.status).toBe('complete');
  });

  it('drops reasoning signatures once the turn is over', async () => {
    const provider = scriptedProvider([[
      { type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, parts: [
        { type: 'reasoning', text: 'thinking', providerMetadata: { claude: { signature: 'sig' } } },
        { type: 'reasoning', text: '', providerMetadata: { claude: { redactedData: 'opaque' } } },
        { type: 'text', text: 'Hi', providerMetadata: { gemini: { thoughtSignature: 'g' }, other: { keep: true } } },
      ] },
    ]]);
    const { result } = await drain({ provider });
    expect(result.message.parts).toEqual([
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'Hi', providerMetadata: { other: { keep: true } } },
    ]);
  });

  it('adds usage to finish only when asked', async () => {
    const { parts } = await drain({ provider: scriptedProvider([textStep('Hi')]), exposeUsage: true });
    expect(parts.at(-1)).toEqual({ type: 'finish', reason: 'stop', usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it('treats a step that ends without finishing as a provider error', async () => {
    const { result } = await drain({ provider: scriptedProvider([[{ type: 'text-delta', delta: 'Hal' }]]) });
    expect(result.status).toBe('incomplete');
    expect((result.error as Error).message).toMatch(/ended without finishing/);
  });
});

describe('runTurn with a provider written for 0.4 (chat only)', () => {
  function legacyProvider(chat: AIProvider['chat']): AIProvider {
    return { name: 'custom', chat};
  }

  it('records the tools it runs, and sends their parts before the next text', async () => {
    const provider = legacyProvider(async function* (params) {
      yield 'One moment. ';
      await params.toolExecutor?.({ id: 'l1', name: 'capture_lead', input: { name: 'Ada', email: 'ada@example.com', projectDetails: 'x' } });
      yield 'Thanks!';
    });
    const { types, result } = await drain({ provider, tools: toolRegistry([new LeadCaptureTool()]) });

    expect(types).toEqual([
      'start', 'text-start', 'text-delta', 'text-end', 'tool-call', 'tool-result', 'lead-captured',
      'text-start', 'text-delta', 'text-end', 'finish',
    ]);
    expect(result.message.parts?.map((p) => p.type)).toEqual(['text', 'tool-call', 'tool-result', 'lead-captured', 'text']);
    expect(result.message.content).toBe('One moment. Thanks!');
  });

  it('passes the request settings through as 0.5 did', async () => {
    const chat = vi.fn(async function* () {
      yield 'ok';
    });
    await drain({ provider: legacyProvider(chat), toolTimeoutMs: 1234, maxTokens: 99, temperature: 0.3 });
    expect(chat.mock.calls[0][0]).toMatchObject({ toolTimeoutMs: 1234, maxTokens: 99, temperature: 0.3, toolExecutor: expect.any(Function) });
  });

  it('leaves aborted replies out of the history it passes, since 0.4 providers read content only', async () => {
    const chat = vi.fn(async function* () {
      yield 'ok';
    });
    await drain({
      provider: legacyProvider(chat),
      messages: [user, { id: 'a0', role: 'assistant', content: 'Half a sen', status: 'aborted', timestamp: 0 }, { ...user, id: 'u2' }],
    });
    expect(chat.mock.calls[0][0].messages.map((m: ChatMessage) => m.id)).toEqual(['u1', 'u2']);
  });

  it("doesn't stream recorded tool parts when the provider then fails", async () => {
    const provider = legacyProvider(async function* (params) {
      await params.toolExecutor?.({ id: 'l1', name: 'capture_lead', input: { name: 'Ada', email: 'ada@example.com', projectDetails: 'x' } });
      throw new Error('upstream 500');
    });
    const { types, result } = await drain({ provider, tools: toolRegistry([new LeadCaptureTool()]) });
    expect(types).toEqual(['start', 'error', 'finish']);
    expect(result.message.parts?.map((p) => p.type)).toEqual(['tool-call', 'tool-result', 'lead-captured']);
  });
});
