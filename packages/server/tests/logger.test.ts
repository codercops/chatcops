import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@chatcops/core';
import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { createChatHandler } from '../src/handler.js';
import { originPolicy } from '../src/security/origin-policy.js';
import { cloudflareClientIp, resetClientIpWarnings } from '../src/client-ip.js';

function recorder() {
  const lines: Array<{ level: string; event: string; message: string; fields?: Record<string, unknown> }> = [];
  const at = (level: string) => (event: string, message: string, fields?: Record<string, unknown>) => {
    lines.push({ level, event, message, ...(fields ? { fields } : {}) });
  };
  const logger: Logger = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { logger, lines };
}

async function drain(parts: AsyncIterable<unknown>) {
  for await (const _ of parts) {
    // read to the end
  }
}

afterEach(() => vi.restoreAllMocks());

describe('the server logger', () => {
  it('gets the startup notes and the errors, and the console gets nothing', async () => {
    const consoleCalls = ['debug', 'info', 'warn', 'error', 'log'].map((level) => vi.spyOn(console, level as 'info').mockImplementation(() => {}));
    const { logger, lines } = recorder();
    const failing = { name: 'lookup', description: 'x', execute: async () => Promise.reject(new Error('db down')) };
    const handler = createChatHandler({
      allowAnonymous: true,
      provider: scriptedProvider([
        [{ type: 'tool-call', call: { id: 't1', name: 'lookup', input: {} } }, { type: 'finish', reason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1 }, parts: [{ type: 'tool-call', toolCallId: 't1', toolName: 'lookup', input: {}, executor: 'server', state: 'pending' }] }],
        textStep('Sorry, I could not look that up.'),
        new Error('model down'),
      ]),
      systemPrompt: 'x',
      tools: [failing],
      logger,
    } as Parameters<typeof createChatHandler>[0]);

    const first = await handler.startChat({ protocol: 1, conversationId: 'c1', message: 'Where is my order?' }, undefined, { format: 'v1' });
    if (first.ok) await drain(first.parts);
    const second = await handler.startChat({ protocol: 1, conversationId: 'c2', message: 'Hi' }, undefined, { format: 'v1' });
    if (second.ok) await drain(second.parts);

    const events = lines.map((line) => `${line.level}:${line.event}`);
    expect(events).toContain('info:security');
    expect(events).toContain('error:tool_error');
    expect(events).toContain('error:provider_error');
    expect(lines.find((line) => line.event === 'tool_error')?.fields).toMatchObject({ tool: 'lookup', error: expect.objectContaining({ message: 'db down' }) });
    expect(handler.logger).toBe(logger);
    for (const spy of consoleCalls) expect(spy).not.toHaveBeenCalled();
  });

  it('reaches the origin policy and the client IP helpers too', () => {
    const { logger, lines } = recorder();
    originPolicy({ allowedOrigins: ['https://acme.test'], logger }).headers('https://evil.test');
    resetClientIpWarnings();
    cloudflareClientIp(new Request('https://acme.test/chat'), undefined, logger);
    expect(lines).toMatchObject([
      { level: 'warn', event: 'origin_refused', fields: { origin: 'https://evil.test' } },
      { level: 'warn', event: 'client_ip', message: 'A request had no CF-Connecting-IP header, so per-IP rate limits and budgets were skipped for it.' },
    ]);
  });
});
