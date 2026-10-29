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
    const { handleChat, cleanup } = createChatHandler({ allowAnonymous: true, provider, systemPrompt: 'Be brief.' });

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
      allowAnonymous: true,
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
    };
    const { handleChat, cleanup } = createChatHandler({ allowAnonymous: true, provider, systemPrompt: 'Be brief.' });
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
      allowAnonymous: true,
      provider,
      systemPrompt: 'Be brief.',
      storage: { conversations: conversationStore },
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
    const { handleChat, cleanup } = createChatHandler({ allowAnonymous: true, provider, systemPrompt: 'Be brief.' });
    await chunks(handleChat({ ...request('Hola'), locale: 'es', pageContext: { url: 'https://acme.test/p', title: 'Pricing' } }));
    cleanup();

    expect(provider.calls[0].systemPrompt).toBe('Be brief.');
    expect(provider.calls[0].systemContext).toMatch(/browser locale is es/);
    expect(provider.calls[0].systemContext).toMatch(/visitor_context/);
  });

  it('answers one reply per conversation at a time', async () => {
    const provider = scriptedProvider(['hang', textStep('Second try works.')]);
    const { handleChat, cleanup } = createChatHandler({ allowAnonymous: true, provider, systemPrompt: 'Be brief.' });
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
      allowAnonymous: true,
      provider,
      systemPrompt: 'Be brief.',
      tools: [{ name: 'again', description: 'Again', inputSchema: { type: 'object', properties: {} }, execute: again }],
    });
    const out = await chunks(handleChat(request('loop')));
    cleanup();

    expect(again).toHaveBeenCalledTimes(5);
    expect(out).toEqual([{ error: 'provider_error' }]);
    expect(error).toHaveBeenCalledWith('[chatcops] Provider error', expect.objectContaining({ message: 'Exceeded maximum tool rounds (5).' }));
    error.mockRestore();
  });
});

describe('regenerate, retry and aborted replies', () => {
  function setup(script: Parameters<typeof scriptedProvider>[0]) {
    const provider = scriptedProvider(script);
    const conversationStore = memoryStorage().conversations;
    const handler = createChatHandler({ allowAnonymous: true, provider, systemPrompt: 'Be brief.', storage: { conversations: conversationStore } });
    const stored = async () => (await conversationStore.get('c1'))?.messages ?? [];
    return { provider, handler, stored };
  }

  it('sends a saved reply again, without calling the model, when an answered message is retried', async () => {
    const { provider, handler, stored } = setup([textStep('The answer.')]);
    const first = await chunks(handler.handleChat({ ...request('Question?'), messageId: 'u1' }));
    const again = await chunks(handler.handleChat({ ...request('Question?'), messageId: 'u1' }));
    handler.cleanup();

    expect(provider.calls).toHaveLength(1);
    expect(again).toEqual([{ content: 'The answer.' }, { done: true }]);
    expect(first.at(-1)).toEqual({ done: true });
    expect((await stored()).map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('regenerates the reply named by assistantMessageId and swaps it in', async () => {
    const { provider, handler, stored } = setup([textStep('First answer.'), textStep('Better answer.')]);
    await chunks(handler.handleChat({ ...request('Question?'), messageId: 'u1' }));
    const firstReply = (await stored())[1];

    await chunks(handler.handleChat({ ...request('Question?'), messageId: 'u1', regenerate: { assistantMessageId: firstReply.id } }));
    handler.cleanup();

    const messages = await stored();
    expect(messages.map((m) => m.content)).toEqual(['Question?', 'Better answer.']);
    // The model didn't see the answer it's replacing. (The last message a
    // step gets is the reply being written.)
    expect(provider.calls[1].messages.slice(0, -1).map((m) => m.content)).toEqual(['Question?']);
  });

  it('keeps an aborted reply out of what the model sees next, and replaces it on retry', async () => {
    const { provider, handler, stored } = setup(['hang', textStep('Full answer.')]);
    const controller = new AbortController();
    const pending = chunks(handler.handleChat({ ...request('Question?'), messageId: 'u1' }, undefined, { signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await pending;
    // Nothing streamed, so nothing was kept.
    expect((await stored()).map((m) => m.role)).toEqual(['user']);

    await chunks(handler.handleChat({ ...request('Question?'), messageId: 'u1' }));
    handler.cleanup();
    expect((await stored()).map((m) => m.content)).toEqual(['Question?', 'Full answer.']);
    expect(provider.calls).toHaveLength(2);
  });

  it('replaces a partial reply that was kept when the visitor left', async () => {
    const provider = scriptedProvider([textStep('Full answer.')]);
    const conversationStore = memoryStorage().conversations;
    await conversationStore.append?.('c1', [
      { id: 'u1', role: 'user', content: 'Question?', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'Full ans', status: 'aborted', timestamp: 2 },
    ]);
    const handler = createChatHandler({ allowAnonymous: true, provider, systemPrompt: 'Be brief.', storage: { conversations: conversationStore } });
    await chunks(handler.handleChat({ ...request('Question?'), messageId: 'u1' }));
    handler.cleanup();

    expect((await conversationStore.get('c1'))?.messages.map((m) => m.content)).toEqual(['Question?', 'Full answer.']);
    // The partial being replaced isn't sent to the model.
    expect(provider.calls[0].messages.slice(0, -1).map((m) => m.content)).toEqual(['Question?']);
  });
});
