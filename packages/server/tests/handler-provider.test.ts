import { LeadCaptureTool, type AIProvider } from '@chatcops/core';
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
