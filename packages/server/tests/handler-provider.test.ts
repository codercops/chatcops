import { LeadCaptureTool, memoryStorage, type AIProvider } from '@chatcops/core';
import { scriptedProvider, textStep, toolStep } from '@chatcops/core/testing/provider';
import { describe, expect, it, vi } from 'vitest';
import { createChatHandler } from '../src/handler.js';

async function chunks(stream: AsyncGenerator<string>) {
  const out: unknown[] = [];
  for await (const chunk of stream) out.push(JSON.parse(chunk));
  return out;
}

const request = (message: string, id = 'c1') => ({ conversationId: id, message });

// No mocks here: the real handler, core and providers, with a scripted model.
describe('a provider object in the server config', () => {
  it('answers with a provider built in code instead of a config', async () => {
    const provider = scriptedProvider([textStep('Hello from a script.')]);
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'Be brief.' });

    const out = await chunks(handleChat(request('Hi')));
    cleanup();

    expect(out.at(-1)).toEqual({ done: true });
    expect(out.slice(0, -1).map((c) => (c as { content: string }).content).join('')).toBe('Hello from a script.');
    expect(provider.calls[0].systemPrompt).toBe('Be brief.');
  });

  it('runs tools and reports a captured lead, as with a built-in provider', async () => {
    const provider = scriptedProvider([
      toolStep([{ name: 'capture_lead', input: { name: 'Ada', email: 'ada@example.com', projectDetails: 'A shop' } }]),
      textStep('Thanks, Ada.'),
    ]);
    const onCapture = vi.fn();
    const { handleChat, cleanup } = createChatHandler({
      provider,
      systemPrompt: 'Be brief.',
      tools: [new LeadCaptureTool(onCapture)],
    });

    const out = await chunks(handleChat(request('I want a website. Ada, ada@example.com')));
    cleanup();

    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ email: 'ada@example.com' }));
    expect(out).toContainEqual(expect.objectContaining({ leadCaptured: true, leadData: expect.objectContaining({ name: 'Ada' }) }));
    expect(out.at(-1)).toEqual({ done: true });
  });

  it('works with a custom provider that only has chat(), as written for 0.4', async () => {
    const provider: AIProvider = {
      name: 'custom',
      async *chat() {
        yield 'custom ';
        yield 'reply';
      },
      chatSync: async () => 'custom reply',
    };
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'Be brief.' });
    const out = await chunks(handleChat(request('Hi')));
    cleanup();
    expect(out).toEqual([{ content: 'custom ' }, { content: 'reply' }, { done: true }]);
  });
});

describe('the handler on runTurn', () => {
  it('saves a reply with tool steps as one message with its parts, status and usage', async () => {
    const lookup = vi.fn(async () => ({ success: true, data: { status: 'shipped' } }));
    const provider = scriptedProvider([
      toolStep([{ id: 't1', name: 'lookup_order', input: { id: 'A-1' } }]),
      textStep('It shipped.'),
    ]);
    const conversationStore = memoryStorage().conversations;
    const { handleChat, cleanup } = createChatHandler({
      provider,
      systemPrompt: 'Be brief.',
      conversationStore,
      tools: [{ name: 'lookup_order', description: 'Look up an order', inputSchema: { type: 'object', properties: {} }, execute: lookup }],
    });

    const out = await chunks(handleChat(request('Where is A-1?')));
    cleanup();

    expect(out.at(-1)).toEqual({ done: true });
    expect(out.slice(0, -1).map((c) => (c as { content: string }).content).join('')).toBe('It shipped.');
    const stored = (await conversationStore.get('c1'))?.messages ?? [];
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(stored[1]).toMatchObject({
      content: 'It shipped.',
      status: 'complete',
      aiGenerated: true,
      usage: { inputTokens: 20, outputTokens: 10 },
    });
    expect(stored[1].parts?.map((p) => p.type)).toEqual(['tool-call', 'tool-result', 'text']);
  });

  it('keeps the system prompt the same on every request and sends the rest after it', async () => {
    const provider = scriptedProvider([textStep('Hola.')]);
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'Be brief.' });
    await chunks(handleChat({ ...request('Hola'), locale: 'es', pageContext: { url: 'https://acme.test/p', title: 'Pricing' } }));
    cleanup();

    expect(provider.calls[0].systemPrompt).toBe('Be brief.');
    expect(provider.calls[0].systemContext).toMatch(/browser locale is es/);
    expect(provider.calls[0].systemContext).toMatch(/visitor_context/);
  });

  it('answers one reply per conversation at a time', async () => {
    const provider = scriptedProvider(['hang', textStep('Second try works.')]);
    const { handleChat, cleanup } = createChatHandler({ provider, systemPrompt: 'Be brief.' });
    const controller = new AbortController();

    const first = chunks(handleChat(request('one'), undefined, { signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await chunks(handleChat(request('two')))).toEqual([{ error: 'provider_error' }]);

    controller.abort();
    await first;
    expect(await chunks(handleChat(request('three')))).toEqual([{ content: 'Second t' }, { content: 'ry works' }, { content: '.' }, { done: true }]);
    cleanup();
  });

  it('reports a reply that runs out of tool rounds as a provider error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = scriptedProvider(Array.from({ length: 6 }, () => toolStep([{ name: 'again' }])));
    const again = vi.fn(async () => ({ success: true }));
    const { handleChat, cleanup } = createChatHandler({
      provider,
      systemPrompt: 'Be brief.',
      tools: [{ name: 'again', description: 'Again', inputSchema: { type: 'object', properties: {} }, execute: again }],
    });
    const out = await chunks(handleChat(request('loop')));
    cleanup();

    expect(again).toHaveBeenCalledTimes(5);
    expect(out).toEqual([{ error: 'provider_error' }]);
    expect(error).toHaveBeenCalledWith('[chatcops] Provider error:', expect.objectContaining({ message: 'Exceeded maximum tool rounds (5).' }));
    error.mockRestore();
  });
});
