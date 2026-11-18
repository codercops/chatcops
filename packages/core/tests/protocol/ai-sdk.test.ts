import { describe, expect, it } from 'vitest';
import { aiSdkEncoder, fromAiSdkRequest } from '../../src/protocol/ai-sdk.js';
import type { WirePart } from '../../src/protocol/v1.js';

function encodeAll(parts: WirePart[]) {
  const encode = aiSdkEncoder();
  return parts.flatMap((part) => encode(part));
}

describe('aiSdkEncoder', () => {
  it('maps a text reply, with the conversation id as message metadata', () => {
    expect(
      encodeAll([
        { type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm1' },
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hi' },
        { type: 'text-end', id: 't1' },
        { type: 'finish', reason: 'stop' },
      ])
    ).toEqual([
      { type: 'start', messageId: 'm1', messageMetadata: { conversationId: 'c1' } },
      { type: 'start-step' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Hi' },
      { type: 'text-end', id: 't1' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'stop' },
    ]);
  });

  it('marks server tools as already run, and leaves client tools to the client', () => {
    expect(
      encodeAll([
        { type: 'tool-call', toolCallId: 's1', toolName: 'lookup', input: { id: 1 }, executor: 'server', title: 'Looking up' },
        { type: 'tool-result', toolCallId: 's1', output: { ok: true } },
        { type: 'tool-call', toolCallId: 'c1', toolName: 'scroll', input: undefined, executor: 'client' },
        { type: 'tool-result', toolCallId: 'c1', error: 'Not allowed' },
      ])
    ).toEqual([
      { type: 'tool-input-available', toolCallId: 's1', toolName: 'lookup', input: { id: 1 }, providerExecuted: true, title: 'Looking up' },
      { type: 'tool-output-available', toolCallId: 's1', output: { ok: true }, providerExecuted: true },
      { type: 'tool-input-available', toolCallId: 'c1', toolName: 'scroll', input: {} },
      { type: 'tool-output-error', toolCallId: 'c1', errorText: 'Not allowed' },
    ]);
  });

  it('sends a result with no output as null', () => {
    expect(encodeAll([{ type: 'tool-result', toolCallId: 'x' }])).toEqual([{ type: 'tool-output-available', toolCallId: 'x', output: null }]);
  });

  it('maps sources and the ChatCops-only parts to source and data chunks', () => {
    const agent = { name: 'Sam' };
    expect(
      encodeAll([
        { type: 'source', sourceId: '1', url: 'https://acme.com/pricing', title: 'Pricing', snippet: 'unused' },
        { type: 'source', sourceId: '2', url: 'https://acme.com' },
        { type: 'lead-captured', lead: { email: 'ada@example.com' } },
        { type: 'suggestions', items: ['Pricing'] },
        { type: 'handoff', status: 'queued', pollAfterMs: 2000 },
        { type: 'agent-message', messageId: 'a1', text: 'Hi, Sam here', agent, timestamp: 1 },
      ])
    ).toEqual([
      { type: 'source-url', sourceId: '1', url: 'https://acme.com/pricing', title: 'Pricing' },
      { type: 'source-url', sourceId: '2', url: 'https://acme.com' },
      { type: 'data-lead-captured', data: { email: 'ada@example.com' } },
      { type: 'data-suggestions', data: ['Pricing'] },
      { type: 'data-handoff', data: { status: 'queued', pollAfterMs: 2000 } },
      { type: 'data-agent-message', data: { messageId: 'a1', text: 'Hi, Sam here', agent, timestamp: 1 } },
    ]);
  });

  it('maps errors and finish reasons', () => {
    expect(
      encodeAll([
        { type: 'error', code: 'budget_exceeded', message: 'The daily budget is used up.', retryable: false, scope: 'global' },
        { type: 'finish', reason: 'error' },
      ])
    ).toEqual([
      { type: 'error', errorText: 'The daily budget is used up.' },
      { type: 'finish-step' },
      { type: 'finish', finishReason: 'error' },
    ]);
    expect(encodeAll([{ type: 'error', code: 'content_filtered', retryable: false }, { type: 'finish', reason: 'error' }]).at(-1)).toEqual({
      type: 'finish',
      finishReason: 'content-filter',
    });
    expect(encodeAll([{ type: 'finish', reason: 'client-tool-calls' }]).at(-1)).toMatchObject({ finishReason: 'tool-calls' });
    expect(encodeAll([{ type: 'finish', reason: 'handoff' }]).at(-1)).toMatchObject({ finishReason: 'other' });
    expect(encodeAll([{ type: 'finish', reason: 'length', usage: { inputTokens: 3, outputTokens: 4 } }]).at(-1)).toEqual({
      type: 'finish',
      finishReason: 'length',
      messageMetadata: { usage: { inputTokens: 3, outputTokens: 4 } },
    });
  });

  it('ends an aborted reply with abort, and skips parts it has no chunk for', () => {
    expect(encodeAll([{ type: 'finish', reason: 'aborted' }])).toEqual([{ type: 'abort', reason: 'aborted' }]);
    expect(encodeAll([{ type: 'some-later-part' } as unknown as WirePart])).toEqual([]);
  });
});

describe('fromAiSdkRequest', () => {
  const messages = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] },
    { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'Hello!' }] },
    { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'Pricing?' }, { type: 'file', url: 'x' }, { type: 'text', text: 'For teams' }] },
  ];

  it('reads the chat id and only the last user message', () => {
    expect(fromAiSdkRequest({ id: 'chat-1', messages, trigger: 'submit-message' })).toEqual({
      conversationId: 'chat-1',
      message: 'Pricing?\n\nFor teams',
      messageId: 'u2',
    });
  });

  it('regenerates an assistant message by id, a user message by id, or the latest', () => {
    const before = messages.slice(0, 1);
    expect(fromAiSdkRequest({ id: 'c', messages: before, trigger: 'regenerate-message', messageId: 'a1' })).toEqual({
      conversationId: 'c',
      message: 'Hi',
      regenerate: { assistantMessageId: 'a1' },
    });
    expect(fromAiSdkRequest({ id: 'c', messages: before, trigger: 'regenerate-message', messageId: 'u1' })).toEqual({
      conversationId: 'c',
      message: 'Hi',
      regenerate: true,
      messageId: 'u1',
    });
    expect(fromAiSdkRequest({ id: 'c', messages: before, trigger: 'regenerate-message' })).toEqual({
      conversationId: 'c',
      message: 'Hi',
      regenerate: true,
    });
  });

  it('passes pageContext, locale and userData through from the body', () => {
    const pageContext = { url: 'https://acme.com', title: 'Acme' };
    expect(fromAiSdkRequest({ id: 'c', messages, pageContext, locale: 'de', userData: { plan: 'pro' } })).toMatchObject({
      pageContext,
      locale: 'de',
      userData: { plan: 'pro' },
    });
  });

  it('leaves anything it cannot read for validation to reject', () => {
    expect(fromAiSdkRequest(null)).toEqual({});
    expect(fromAiSdkRequest('text')).toEqual({});
    expect(fromAiSdkRequest({ id: 'c', messages: 'nope' })).toEqual({ conversationId: 'c', message: '' });
    expect(fromAiSdkRequest({ id: 'c', messages: [{ role: 'user', parts: 'nope' }] })).toEqual({ conversationId: 'c', message: '' });
  });
});
