import { memoryStorage, type KnowledgeSource, type RetrievedChunk } from '@chatcops/core';
import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { describe, expect, it } from 'vitest';
import { createChatHandler } from '../src/handler.js';

const chunk = (id: string, text: string): RetrievedChunk => ({
  id,
  text,
  score: 1,
  source: { id: `https://example.test/${id}`, url: `https://example.test/${id}`, title: `Page ${id}` },
});
const retrieving = (chunks: RetrievedChunk[]): KnowledgeSource => ({ type: 'test', retrieve: async () => chunks, getContext: async () => '' });
const long = 'Our Team plan costs twenty dollars per seat each month and includes shared inboxes, priority support, usage reports and single sign-on for every member.';

async function reply(options: { provider: ReturnType<typeof scriptedProvider>; knowledge?: KnowledgeSource[] }) {
  const storage = memoryStorage();
  const { handleChat, cleanup } = createChatHandler({ allowAnonymous: true, systemPrompt: 'Be brief.', storage, ...options });
  for await (const _ of handleChat({ conversationId: 'c1', message: 'How much is Team?' }, { protocol: 'v1' } as never)) {
    // Only what's stored matters here.
  }
  cleanup();
  return (await storage.conversations.get('c1'))?.messages.at(-1);
}

describe('answered verdict on saved replies', () => {
  it('marks a cited reply as answered', async () => {
    const provider = scriptedProvider(
      [[
        { type: 'text-delta', delta: long },
        { type: 'source', index: 0 },
        { type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, parts: [{ type: 'text', text: long }] },
      ]],
      { citations: 'native' }
    );
    const saved = await reply({ provider, knowledge: [retrieving([chunk('a', 'Team is $20.')])] });
    expect(saved?.metadata).toMatchObject({ answered: true });
    expect(saved?.metadata).not.toHaveProperty('unansweredReason');
  });

  it('flags a long reply that cites none of the retrieved pages', async () => {
    const saved = await reply({ provider: scriptedProvider([textStep(long)]), knowledge: [retrieving([chunk('a', 'Team is $20.')])] });
    expect(saved?.metadata).toMatchObject({ answered: false, unansweredReason: 'no_citation' });
  });

  it('flags a reply when retrieval found nothing', async () => {
    const saved = await reply({ provider: scriptedProvider([textStep('Hmm.')]), knowledge: [retrieving([])] });
    expect(saved?.metadata).toMatchObject({ answered: false, unansweredReason: 'no_retrieval' });
  });

  it('flags a refusal without any knowledge, and marks a plain reply answered', async () => {
    expect((await reply({ provider: scriptedProvider([textStep("I don't know that one.")]) }))?.metadata).toMatchObject({ answered: false, unansweredReason: 'refusal' });
    expect((await reply({ provider: scriptedProvider([textStep('Team is $20 a month.')]) }))?.metadata).toMatchObject({ answered: true });
  });
});
