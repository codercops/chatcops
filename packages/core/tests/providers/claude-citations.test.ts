import { describe, expect, it } from 'vitest';
import { runTurn } from '../../src/agent/run-turn.js';
import { ClaudeProvider, withSearchResults } from '../../src/providers/claude.js';
import type { RetrievedChunk } from '../../src/retrieval/types.js';
import type { WirePart } from '../../src/protocol/v1.js';
import { replayFetch } from '../helpers/replay-fetch.js';
import { SYSTEM, user } from '../helpers/step.js';

// The same sources scripts/record-fixtures.mjs recorded with.
const SOURCES: RetrievedChunk[] = [
  {
    id: 'pricing-0',
    text: 'The Team plan costs $20 per user per month, billed annually. The Starter plan is free for up to 3 users.',
    score: 1,
    source: { id: 'https://example.test/pricing', url: 'https://example.test/pricing', title: 'Pricing', section: 'Plans' },
  },
  {
    id: 'refunds-0',
    text: 'Refunds are available within 30 days of purchase. Contact support with your order number.',
    score: 0.8,
    source: { id: 'https://example.test/refunds', url: 'https://example.test/refunds', title: 'Refund policy' },
  },
];
const QUESTION = 'How much is the Team plan, and can I get a refund?';

describe('Claude native citations, from a recorded response', () => {
  it('sends the sources as search results and reports what the reply cited', async () => {
    const replay = replayFetch('claude', 'citations');
    const claude = new ClaudeProvider({ type: 'claude', apiKey: 'test-key', fetch: replay.fetch });
    expect(claude.citations).toBe('native');

    const events = [];
    for await (const event of claude.step({ messages: [user(QUESTION)], systemPrompt: SYSTEM, sources: SOURCES })) events.push(event);

    expect(replay.requests[0]).toEqual(replay.recordedRequests[0]);
    const sources = events.filter((e) => e.type === 'source');
    expect(sources.length).toBeGreaterThan(0);
    for (const event of sources) expect((event as { index: number }).index).toBeLessThan(SOURCES.length);
    expect(sources[0]).toEqual({ type: 'source', index: 0 });
  });

  it('becomes a source part for the cited page in a full turn', async () => {
    const replay = replayFetch('claude', 'citations');
    const claude = new ClaudeProvider({ type: 'claude', apiKey: 'test-key', fetch: replay.fetch });
    const parts: WirePart[] = [];
    for await (const part of runTurn({ provider: claude, messages: [user(QUESTION)], systemPrompt: SYSTEM, conversationId: 'c1', sources: SOURCES })) {
      parts.push(part);
    }
    expect(parts.filter((p) => p.type === 'source')).toEqual([
      expect.objectContaining({ type: 'source', sourceId: 'https://example.test/pricing', url: 'https://example.test/pricing', title: 'Pricing' }),
    ]);
    const text = parts.filter((p) => p.type === 'text-delta').map((p) => (p as { delta: string }).delta).join('');
    expect(text).toContain('$20');
  });
});

describe('withSearchResults', () => {
  it('puts the sources before the text of the latest visitor message, with citations on', () => {
    const [first, second] = withSearchResults(
      [
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] },
      ].concat([{ role: 'user', content: QUESTION }]) as never,
      SOURCES
    ).slice(-2) as never as Array<{ role: string; content: unknown }>;
    expect(first.role).toBe('assistant');
    expect(second.content).toEqual([
      {
        type: 'search_result',
        source: 'https://example.test/pricing',
        title: 'Pricing > Plans',
        content: [{ type: 'text', text: SOURCES[0].text }],
        citations: { enabled: true },
      },
      {
        type: 'search_result',
        source: 'https://example.test/refunds',
        title: 'Refund policy',
        content: [{ type: 'text', text: SOURCES[1].text }],
        citations: { enabled: true },
      },
      { type: 'text', text: QUESTION },
    ]);
  });

  it('skips a turn that only carries tool results, so sources stay with the question', () => {
    const messages = withSearchResults(
      [
        { role: 'user', content: [{ type: 'text', text: QUESTION }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'lookup', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
      ] as never,
      SOURCES
    ) as never as Array<{ content: Array<{ type: string }> }>;
    expect(messages[0].content.map((b) => b.type)).toEqual(['search_result', 'search_result', 'text']);
    expect(messages[2].content.map((b) => b.type)).toEqual(['tool_result']);
  });

  it('leaves messages alone without sources, and uses the url when a page has no title', () => {
    const messages = [{ role: 'user' as const, content: 'Hi' }];
    expect(withSearchResults(messages, undefined)).toBe(messages);
    expect(withSearchResults(messages, [])).toBe(messages);
    const untitled = { ...SOURCES[1], source: { id: 'x', url: 'https://example.test/x' } };
    const [message] = withSearchResults(messages, [untitled]) as never as Array<{ content: Array<{ title?: string }> }>;
    expect(message.content[0].title).toBe('https://example.test/x');
  });
});
