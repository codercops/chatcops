import { describe, expect, it } from 'vitest';
import { messageText, partsOf } from '../src/parts.js';
import type { ChatMessage, MessagePart } from '../src/types.js';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: 'm1', role: 'assistant', content: '', timestamp: 0, ...overrides };
}

describe('partsOf', () => {
  it('treats the content of a message saved without parts as one text part', () => {
    expect(partsOf(message({ content: 'Hello' }))).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('returns no parts for an empty legacy message', () => {
    expect(partsOf(message({ content: '' }))).toEqual([]);
  });

  it('returns the stored parts when there are any, ignoring content', () => {
    const parts: MessagePart[] = [
      { type: 'reasoning', text: 'thinking', providerMetadata: { claude: { signature: 'sig' } } },
      { type: 'text', text: 'Let me check. ' },
      {
        type: 'tool-call',
        toolCallId: 'call_1',
        toolName: 'capture_lead',
        input: { email: 'a@b.co' },
        executor: 'server',
        state: 'done',
      },
      { type: 'tool-result', toolCallId: 'call_1', toolName: 'capture_lead', output: { success: true } },
      { type: 'text', text: 'Saved.' },
    ];
    expect(partsOf(message({ content: 'stale', parts }))).toBe(parts);
  });

  it('keeps an explicit empty parts list', () => {
    expect(partsOf(message({ content: 'stale', parts: [] }))).toEqual([]);
  });
});

describe('messageText', () => {
  it('joins text parts and skips everything else', () => {
    const parts: MessagePart[] = [
      { type: 'reasoning', text: 'not shown' },
      { type: 'text', text: 'Let me check. ' },
      { type: 'tool-call', toolCallId: 'c', toolName: 't', input: {}, executor: 'server', state: 'done' },
      { type: 'tool-result', toolCallId: 'c', toolName: 't', output: 1 },
      { type: 'source', sourceId: '1', url: 'https://example.com' },
      { type: 'text', text: 'Saved.' },
    ];
    expect(messageText(parts)).toBe('Let me check. Saved.');
  });

  it('round trips with partsOf for legacy messages', () => {
    const legacy = message({ content: 'Just text' });
    expect(messageText(partsOf(legacy))).toBe(legacy.content);
  });

  it('returns an empty string for no parts', () => {
    expect(messageText([])).toBe('');
  });
});
