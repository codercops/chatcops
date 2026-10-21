import { describe, expect, it } from 'vitest';
import { estimateTokens, normalizeHistory, normalizeTurns, trimHistory } from '../../src/providers/history.js';
import type { ChatMessage, MessagePart, ToolCallPart, ToolResultPart } from '../../src/types.js';

const m = (role: ChatMessage['role'], content: string, id = content): ChatMessage => ({ id, role, content, timestamp: 0 });
/** A message that costs exactly `tokens` by estimateTokens. */
const sized = (role: ChatMessage['role'], id: string, tokens: number): ChatMessage => m(role, 'x'.repeat((tokens - 4) * 3.5), id);

describe('estimateTokens', () => {
  it('counts about 3.5 characters per token plus overhead', () => {
    expect(estimateTokens({ content: '' })).toBe(4);
    expect(estimateTokens({ content: 'x'.repeat(35) })).toBe(14);
  });
});

describe('trimHistory', () => {
  it('returns every user and assistant turn when they fit', () => {
    const messages = [m('system', 's'), m('user', 'u1'), m('assistant', 'a1'), m('user', 'u2')];
    expect(trimHistory(messages, 1000).map((x) => x.id)).toEqual(['u1', 'a1', 'u2']);
  });

  it('keeps the first user turn and the newest turns that fit', () => {
    const messages = [
      sized('user', 'u1', 10),
      sized('assistant', 'a1', 100),
      sized('user', 'u2', 100),
      sized('assistant', 'a2', 20),
      sized('user', 'u3', 20),
    ];
    // Budget 60: u1 (10) + u3 (20) + a2 (20) = 50; u2 doesn't fit.
    // The tail would start with a2, so it starts at u3 instead.
    expect(trimHistory(messages, 60).map((x) => x.id)).toEqual(['u1', 'u3']);
  });

  it('keeps a tail that already starts with a user turn', () => {
    const messages = [
      sized('user', 'u1', 10),
      sized('assistant', 'a1', 100),
      sized('user', 'u2', 20),
      sized('assistant', 'a2', 20),
      sized('user', 'u3', 20),
    ];
    expect(trimHistory(messages, 80).map((x) => x.id)).toEqual(['u1', 'u2', 'a2', 'u3']);
  });

  it('keeps the latest message even when it alone is over the budget', () => {
    const messages = [sized('user', 'u1', 10), sized('assistant', 'a1', 10), sized('user', 'huge', 500)];
    expect(trimHistory(messages, 50).map((x) => x.id)).toEqual(['u1', 'huge']);
  });

  it('keeps a 120-turn conversation within budget and opening with the visitor', () => {
    const messages: ChatMessage[] = [];
    for (let i = 0; i < 120; i++) {
      messages.push(sized('user', `u${i}`, 200), sized('assistant', `a${i}`, 400));
    }
    const kept = trimHistory(messages, 8000);
    expect(kept[0].id).toBe('u0');
    expect(kept.at(-1)?.id).toBe('a119');
    expect(kept.reduce((sum, x) => sum + estimateTokens(x), 0)).toBeLessThanOrEqual(8000);
    const normalized = normalizeHistory(kept);
    expect(normalized[0].role).toBe('user');
    for (let i = 1; i < normalized.length; i++) {
      expect(normalized[i].role).not.toBe(normalized[i - 1].role);
    }
  });

  it('returns nothing when there is no user turn', () => {
    expect(trimHistory([sized('assistant', 'a1', 100)], 10)).toEqual([]);
  });
});

describe('normalizeTurns', () => {
  const call = (id: string): ToolCallPart => ({
    type: 'tool-call', toolCallId: id, toolName: 'lookup', input: { id }, executor: 'server', state: 'done',
  });
  const result = (id: string): ToolResultPart => ({ type: 'tool-result', toolCallId: id, toolName: 'lookup', output: { success: true } });
  const assistant = (parts: MessagePart[], extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'a', role: 'assistant', content: '', parts, timestamp: 0, ...extra,
  });

  it('keeps tool calls and their results in order', () => {
    const turns = normalizeTurns([m('user', 'hi'), assistant([call('t1'), result('t1'), { type: 'text', text: 'done' }])]);
    expect(turns).toEqual([
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', parts: [call('t1'), result('t1'), { type: 'text', text: 'done' }] },
    ]);
  });

  it('gives a call without a result a "not run" result, before the next step starts', () => {
    const turns = normalizeTurns([
      m('user', 'hi'),
      assistant([call('t1'), call('t2'), result('t1'), { type: 'text', text: 'next' }]),
    ]);
    expect(turns[1].parts.map((p) => (p.type === 'tool-result' ? `${p.toolCallId}:${p.error ?? 'ok'}` : p.type))).toEqual([
      'tool-call', 'tool-call', 't1:ok', 't2:The tool was not run.', 'text',
    ]);
  });

  it('closes calls left open at the end of a message, and drops results with no call', () => {
    const turns = normalizeTurns([m('user', 'hi'), assistant([result('stray'), call('t1')])]);
    expect(turns[1].parts).toEqual([call('t1'), { ...result('t1'), output: undefined, error: 'The tool was not run.' }]);
  });

  it('drops the half-finished text of an aborted reply but keeps the tool steps before it', () => {
    const turns = normalizeTurns([
      m('user', 'hi'),
      assistant([call('t1'), result('t1'), { type: 'text', text: 'The order is on its wa' }], { status: 'aborted' }),
    ]);
    expect(turns[1].parts).toEqual([call('t1'), result('t1')]);
    expect(normalizeTurns([m('user', 'hi'), assistant([{ type: 'text', text: 'Half a sen' }], { status: 'aborted' })])).toHaveLength(1);
  });

  it('drops system messages, sources, leads and leading assistant turns, and merges same-role text', () => {
    const turns = normalizeTurns([
      m('assistant', 'welcome'),
      m('system', 'note'),
      m('user', 'one'),
      { ...m('user', 'two'), parts: [{ type: 'text', text: 'two' }, { type: 'source', sourceId: 's', url: 'https://x.test' }] },
      assistant([{ type: 'lead-captured', lead: { email: 'a@b.test' } }, { type: 'text', text: '  ' }]),
    ]);
    expect(turns).toEqual([{ role: 'user', parts: [{ type: 'text', text: 'one\n\ntwo' }] }]);
  });
});

describe('estimateTokens with parts', () => {
  it('counts tool input and output, not just the text', () => {
    const parts: MessagePart[] = [
      { type: 'tool-call', toolCallId: 't', toolName: 'lookup', input: { q: 'x'.repeat(70) }, executor: 'server', state: 'done' },
    ];
    expect(estimateTokens({ content: '', parts })).toBeGreaterThan(20);
    expect(estimateTokens({ content: 'ignored when there are parts', parts: [] })).toBe(4);
  });
});
