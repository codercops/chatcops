import { describe, expect, it } from 'vitest';
import * as core from '../../src/index.js';
import type { WirePart } from '../../src/protocol/index.js';
import type { ProviderEvent } from '../../src/providers/types.js';

describe('protocol v1', () => {
  it('is version 1, exported from the package entry', () => {
    expect(core.PROTOCOL_VERSION).toBe(1);
  });

  it('describes a typical stream', () => {
    const stream: WirePart[] = [
      { type: 'start', protocol: 1, conversationId: 'c1', messageId: 'm1' },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Our Starter plan is $19/month.' },
      { type: 'text-end', id: 't1' },
      { type: 'source', sourceId: '1', url: 'https://acme.com/pricing', title: 'Pricing' },
      { type: 'error', code: 'rate_limited', retryable: true, retryAfterMs: 42_000, scope: 'ip' },
      { type: 'finish', reason: 'stop' },
    ];
    expect(JSON.parse(JSON.stringify(stream))).toEqual(stream);
  });
});

describe('ProviderEvent', () => {
  it('ends a step with the parts to store', () => {
    const finish: ProviderEvent = {
      type: 'finish',
      reason: 'tool-calls',
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 8 },
      parts: [
        { type: 'text', text: 'One moment.' },
        { type: 'tool-call', toolCallId: 'c', toolName: 't', input: {}, executor: 'server', state: 'pending' },
      ],
    };
    expect(finish.type).toBe('finish');
  });
});
