import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';
import { type LegacyChunk, toLegacyChunk } from '../../src/protocol/legacy.js';
import type { WireErrorCode, WireFinishReason, WirePart } from '../../src/protocol/index.js';

const error = (code: WireErrorCode, extra: Partial<Extract<WirePart, { type: 'error' }>> = {}): WirePart => ({
  type: 'error',
  code,
  retryable: false,
  ...extra,
});

const finish = (reason: WireFinishReason): WirePart => ({ type: 'finish', reason });

describe('toLegacyChunk', () => {
  it('is exported from the package entry', () => {
    expect(core.toLegacyChunk).toBe(toLegacyChunk);
  });

  describe('parts that carry content', () => {
    it('turns text-delta into content', () => {
      expect(toLegacyChunk({ type: 'text-delta', id: 't1', delta: 'Hi' })).toStrictEqual({ content: 'Hi' });
    });

    it('turns lead-captured into leadCaptured and leadData', () => {
      const lead = { name: 'Ada', email: 'ada@example.com' };
      expect(toLegacyChunk({ type: 'lead-captured', lead })).toStrictEqual({ leadCaptured: true, leadData: lead });
    });

    it('turns suggestions into suggestedActions', () => {
      expect(toLegacyChunk({ type: 'suggestions', items: ['Pricing', 'Talk to sales'] })).toStrictEqual({
        suggestedActions: ['Pricing', 'Talk to sales'],
      });
    });
  });

  describe('error parts', () => {
    it('maps rate_limited to rate_limit', () => {
      expect(toLegacyChunk(error('rate_limited', { retryable: true, retryAfterMs: 42_000 }))).toStrictEqual({
        error: 'rate_limit',
        retryAfter: 42,
      });
    });

    it('rounds retryAfterMs up to whole seconds', () => {
      expect(toLegacyChunk(error('rate_limited', { retryAfterMs: 1500 }))).toStrictEqual({
        error: 'rate_limit',
        retryAfter: 2,
      });
      expect(toLegacyChunk(error('rate_limited', { retryAfterMs: 1000 }))).toStrictEqual({
        error: 'rate_limit',
        retryAfter: 1,
      });
      expect(toLegacyChunk(error('rate_limited', { retryAfterMs: 1 }))).toStrictEqual({
        error: 'rate_limit',
        retryAfter: 1,
      });
    });

    it('leaves retryAfter out when there is no delay', () => {
      expect(toLegacyChunk(error('rate_limited'))).toStrictEqual({ error: 'rate_limit' });
      expect(toLegacyChunk(error('rate_limited', { retryAfterMs: 0 }))).toStrictEqual({ error: 'rate_limit' });
      expect(toLegacyChunk(error('rate_limited', { retryAfterMs: Number.NaN }))).toStrictEqual({
        error: 'rate_limit',
      });
    });

    it('maps timeout to timeout', () => {
      expect(toLegacyChunk(error('timeout'))).toStrictEqual({ error: 'timeout' });
    });

    it('maps internal_error to internal_error', () => {
      expect(toLegacyChunk(error('internal_error'))).toStrictEqual({ error: 'internal_error' });
    });

    it('maps invalid_request to "Invalid request", what 0.5 servers send', () => {
      expect(toLegacyChunk(error('invalid_request'))).toStrictEqual({ error: 'Invalid request' });
    });

    it.each<WireErrorCode>([
      'session_required',
      'token_expired',
      'conversation_mismatch',
      'turnstile_failed',
      'origin_not_allowed',
      'conversation_busy',
      'payload_too_large',
      'provider_unavailable',
      'provider_error',
      'tool_error',
      'budget_exceeded',
      'content_filtered',
    ])('maps %s to provider_error', (code) => {
      expect(toLegacyChunk(error(code))).toStrictEqual({ error: 'provider_error' });
    });
  });

  describe('finish parts', () => {
    it.each<WireFinishReason>(['error', 'aborted'])('gives null for %s', (reason) => {
      expect(toLegacyChunk(finish(reason))).toBeNull();
    });

    it.each<WireFinishReason>(['stop', 'length', 'client-tool-calls', 'approval-required', 'handoff'])(
      'turns %s into done',
      (reason) => {
        expect(toLegacyChunk(finish(reason))).toStrictEqual({ done: true });
      },
    );
  });

  describe('parts an old widget has no use for', () => {
    it.each<[string, WirePart]>([
      ['start', { type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm1' }],
      ['text-start', { type: 'text-start', id: 't1' }],
      ['text-end', { type: 'text-end', id: 't1' }],
      ['source', { type: 'source', sourceId: '1', url: 'https://acme.com/pricing' }],
      [
        'tool-call',
        { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: {}, executor: 'server' },
      ],
      ['tool-result', { type: 'tool-result', toolCallId: 'c1', output: { ok: true } }],
      ['handoff', { type: 'handoff', status: 'requested' }],
      [
        'agent-message',
        { type: 'agent-message', messageId: 'm2', text: 'Hi', agent: { name: 'Sam' }, timestamp: 1 },
      ],
    ])('gives null for %s', (_name, part) => {
      expect(toLegacyChunk(part)).toBeNull();
    });

    it('gives null for a part type added after this was written', () => {
      expect(toLegacyChunk({ type: 'something-new' } as unknown as WirePart)).toBeNull();
    });
  });

  it('turns a whole v1 stream into the chunks a 0.5 server sends for the same reply', () => {
    // The same reply as the 0.5 stream below: three text chunks, suggestions, then done.
    const v1: WirePart[] = [
      { type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm1' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Our Starter ' },
      { type: 'text-delta', id: 't1', delta: 'plan is ' },
      { type: 'text-delta', id: 't1', delta: '$19/month.' },
      { type: 'text-end', id: 't1' },
      { type: 'suggestions', items: ['See all plans', 'Talk to sales'] },
      { type: 'finish', reason: 'stop' },
    ];

    const legacy = v1.map(toLegacyChunk).filter((chunk): chunk is LegacyChunk => chunk !== null);

    // What a 0.5 server writes: one JSON chunk per piece of text, then done.
    const fromV05: LegacyChunk[] = [
      { content: 'Our Starter ' },
      { content: 'plan is ' },
      { content: '$19/month.' },
      { suggestedActions: ['See all plans', 'Talk to sales'] },
      { done: true },
    ];
    expect(legacy).toStrictEqual(fromV05);
    // Over the wire they are the same lines, too.
    expect(legacy.map((chunk) => JSON.stringify(chunk))).toStrictEqual(fromV05.map((chunk) => JSON.stringify(chunk)));
  });

  it('turns a v1 stream with a captured lead into the 0.5 chunks, in order', () => {
    const lead = { email: 'lead@example.com' };
    const v1: WirePart[] = [
      { type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm1' },
      { type: 'lead-captured', lead },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Thanks, we will reach out shortly.' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', reason: 'stop' },
    ];

    expect(v1.map(toLegacyChunk).filter((chunk) => chunk !== null)).toStrictEqual([
      { leadCaptured: true, leadData: lead },
      { content: 'Thanks, we will reach out shortly.' },
      { done: true },
    ]);
  });

  it('turns a v1 stream that fails partway into the error chunk and no done', () => {
    const v1: WirePart[] = [
      { type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm1' },
      { type: 'text-delta', id: 't1', delta: 'Partial' },
      { type: 'error', code: 'provider_error', retryable: true },
      { type: 'finish', reason: 'error' },
    ];

    expect(v1.map(toLegacyChunk).filter((chunk) => chunk !== null)).toStrictEqual([
      { content: 'Partial' },
      { error: 'provider_error' },
    ]);
  });
});
