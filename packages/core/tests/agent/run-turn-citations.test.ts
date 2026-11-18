import { describe, expect, it } from 'vitest';
import { runTurn, type RunTurnOptions, type TurnResult } from '../../src/agent/run-turn.js';
import type { WirePart } from '../../src/protocol/v1.js';
import { CITE_INSTRUCTION, NATIVE_SOURCES_INSTRUCTION } from '../../src/retrieval/citations.js';
import type { RetrievedChunk } from '../../src/retrieval/types.js';
import { scriptedProvider, textStep, toolStep } from '../../src/testing/provider.js';
import { toolRegistry } from '../../src/agent/tool-registry.js';
import type { AIProvider } from '../../src/providers/types.js';
import type { ChatMessage } from '../../src/types.js';

const user: ChatMessage = { id: 'u1', role: 'user', content: 'How much is the Team plan?', timestamp: 0 };
const chunk = (id: string, page = id): RetrievedChunk => ({
  id,
  text: `Text from ${id}.`,
  score: 1,
  source: { id: `page-${page}`, url: `https://example.test/${page}`, title: `Page ${page}` },
});
const SOURCES = [chunk('pricing'), chunk('pricing-2', 'pricing'), chunk('faq')];

async function drain(options: Partial<RunTurnOptions> & Pick<RunTurnOptions, 'provider'>) {
  const persisted: ChatMessage[] = [];
  const turn = runTurn({
    messages: [user],
    systemPrompt: 'Be brief.',
    conversationId: 'c1',
    messageId: 'm1',
    onPersist: (message, { final }) => {
      if (final) persisted.push(structuredClone(message));
    },
    ...options,
  });
  const parts: WirePart[] = [];
  let next = await turn.next();
  while (!next.done) {
    parts.push(next.value);
    next = await turn.next();
  }
  const text = parts.filter((p) => p.type === 'text-delta').map((p) => (p as { delta: string }).delta).join('');
  const sources = parts.filter((p) => p.type === 'source');
  return { parts, text, sources, result: next.value as TurnResult, stored: persisted.at(-1) };
}

describe('citations with [n] markers (providers without native citations)', () => {
  it('gives the model the numbered sources and how to cite them, after the other context', async () => {
    const provider = scriptedProvider([textStep('ok')]);
    await drain({ provider, sources: SOURCES, systemContext: 'Reply in German.' });
    const context = provider.calls[0].systemContext ?? '';
    expect(context.startsWith('Reply in German.')).toBe(true);
    expect(context).toContain('<source id="1" url="https://example.test/pricing" title="Page pricing">');
    expect(context).toContain('<source id="3" url="https://example.test/faq"');
    expect(context.endsWith(CITE_INSTRUCTION)).toBe(true);
    expect(provider.calls[0]).not.toHaveProperty('sources');
  });

  it('turns cited numbers into source parts, one per page, and removes numbers with no source', async () => {
    const reply = 'The Team plan is $20 [1][2]. See the FAQ [3]. Made up [9].';
    const { text, sources, stored, parts } = await drain({
      provider: scriptedProvider([textStep(reply, { chunkSize: 3 })]),
      sources: SOURCES,
    });

    expect(text).toBe('The Team plan is $20 [1][2]. See the FAQ [3]. Made up .');
    // [1] and [2] are the same page, so one source part for it.
    expect(sources).toEqual([
      { type: 'source', sourceId: 'page-pricing', url: 'https://example.test/pricing', title: 'Page pricing', snippet: 'Text from pricing.' },
      { type: 'source', sourceId: 'page-faq', url: 'https://example.test/faq', title: 'Page faq', snippet: 'Text from faq.' },
    ]);
    // Sources come after the text they cite.
    const types = parts.map((p) => p.type);
    expect(types.indexOf('source')).toBeGreaterThan(types.indexOf('text-end'));
    // The stored reply matches what was streamed, and keeps the sources.
    expect(stored?.content).toBe(text);
    expect(stored?.parts?.filter((p) => p.type === 'source')).toHaveLength(2);
  });

  it('cites each page once across tool rounds', async () => {
    const lookup = { name: 'lookup', description: 'lookup', inputSchema: { type: 'object' as const, properties: {} }, execute: async () => ({ success: true, data: 'ok' }) };
    const { sources } = await drain({
      provider: scriptedProvider([toolStep([{ name: 'lookup' }], { text: 'Checking [3]. ' }), textStep('It is $20 [1], see [3].')]),
      sources: SOURCES,
      tools: toolRegistry([lookup]),
    });
    expect(sources.map((s) => (s as { sourceId: string }).sourceId)).toEqual(['page-faq', 'page-pricing']);
  });

  it('works for a 0.4 provider that only has chat(), too', async () => {
    const provider: AIProvider = {
      name: 'legacy',
      async *chat() {
        yield 'Twenty dollars [';
        yield '1]. Fake [5].';
      },
    };
    const { text, sources, stored } = await drain({ provider, sources: SOURCES });
    expect(text).toBe('Twenty dollars [1]. Fake .');
    expect(sources).toHaveLength(1);
    expect(stored?.content).toBe('Twenty dollars [1]. Fake .');
  });

  it('changes nothing when there are no sources', async () => {
    const provider = scriptedProvider([textStep('Literal [9] stays.')]);
    const { text, sources } = await drain({ provider, systemContext: 'Context.' });
    expect(text).toBe('Literal [9] stays.');
    expect(sources).toEqual([]);
    expect(provider.calls[0].systemContext).toBe('Context.');
  });
});

describe('native citations', () => {
  it('gives the provider the sources themselves and maps its source events, once per page', async () => {
    const provider = scriptedProvider(
      [[
        { type: 'text-delta', delta: 'The Team plan is $20.' },
        { type: 'source', index: 0 },
        { type: 'source', index: 1 },
        { type: 'source', index: 2 },
        { type: 'source', index: 0 },
        { type: 'source', index: 7 },
        { type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, parts: [{ type: 'text', text: 'The Team plan is $20.' }] },
      ]],
      { citations: 'native' }
    );
    const { text, sources } = await drain({ provider, sources: SOURCES, systemContext: 'Context.' });

    expect(provider.calls[0].sources).toEqual(SOURCES);
    expect(provider.calls[0].systemContext).toBe(`Context.\n\n${NATIVE_SOURCES_INSTRUCTION}`);
    expect(provider.calls[0].systemContext).not.toContain('<sources>');
    expect(text).toBe('The Team plan is $20.');
    // Index 7 matches nothing and is ignored; pages are cited once.
    expect(sources.map((s) => (s as { sourceId: string }).sourceId)).toEqual(['page-pricing', 'page-faq']);
  });

  it("doesn't touch [n] in native providers' text", async () => {
    const provider = scriptedProvider([textStep('Array index [9] is fine.')], { citations: 'native' });
    const { text } = await drain({ provider, sources: SOURCES });
    expect(text).toBe('Array index [9] is fine.');
  });
});
