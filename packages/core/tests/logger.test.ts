import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTurn } from '../src/agent/run-turn.js';
import { toolRegistry } from '../src/agent/tool-registry.js';
import { scriptedProvider } from '../src/testing/provider.js';
import { consoleLogger, jsonLogger, silentLogger, type Logger } from '../src/logger.js';
import { ClaudeProvider } from '../src/providers/claude.js';
import { LeadCaptureTool } from '../src/tools/lead-capture.js';

/** A logger that keeps what it's given. */
function recorder() {
  const lines: Array<{ level: string; event: string; message: string; fields?: Record<string, unknown> }> = [];
  const at = (level: string) => (event: string, message: string, fields?: Record<string, unknown>) => {
    lines.push({ level, event, message, ...(fields ? { fields } : {}) });
  };
  const logger: Logger = { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
  return { logger, lines };
}

afterEach(() => vi.restoreAllMocks());

describe('consoleLogger', () => {
  it('writes [chatcops] lines at the matching console level, with an error after them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = consoleLogger();
    logger.warn('memory_storage', 'No storage is set.', { extra: 1 });
    const failure = new Error('boom');
    logger.error('provider_error', 'Provider error', { error: failure });
    expect(warn).toHaveBeenCalledWith('[chatcops] No storage is set.');
    expect(error).toHaveBeenCalledWith('[chatcops] Provider error', failure);
  });
});

describe('jsonLogger', () => {
  it('writes one JSON object per line, with errors spelled out', () => {
    const lines: string[] = [];
    const logger = jsonLogger({ write: (line) => lines.push(line) });
    logger.error('tool_error', 'Tool lookup threw', { tool: 'lookup', error: new TypeError('bad input') });
    const line = JSON.parse(lines[0]);
    expect(line).toMatchObject({ level: 'error', event: 'tool_error', message: 'Tool lookup threw', tool: 'lookup', error: { name: 'TypeError', message: 'bad input' } });
    expect(line.error.stack).toContain('TypeError');
    expect(new Date(line.time).toString()).not.toBe('Invalid Date');
  });

  it('drops lines below its level, and goes to console.error by default', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logger = jsonLogger({ level: 'warn' });
    logger.debug('a', 'debug');
    logger.info('b', 'info');
    logger.warn('c', 'warn');
    expect(error).toHaveBeenCalledOnce();
    expect(JSON.parse(error.mock.calls[0][0] as string)).toMatchObject({ event: 'c' });
    const silent = silentLogger();
    for (const level of ['debug', 'info', 'warn', 'error'] as const) silent[level]('x', 'nothing');
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('tool errors', () => {
  const context = (logger: Logger) => ({ conversationId: 'c1', signal: new AbortController().signal, logger });

  it('logs what a tool throws in full, and tells the model only that it failed', async () => {
    const { logger, lines } = recorder();
    const secret = new Error('connect ECONNREFUSED postgres://admin:hunter2@db:5432');
    const tool = { name: 'lookup_order', description: 'x', execute: async () => Promise.reject(secret) };
    const result = await toolRegistry([tool]).run({ id: '1', name: 'lookup_order', input: {} }, context(logger));
    expect(result).toEqual({ success: false, message: 'Tool failed: lookup_order' });
    expect(lines).toEqual([{ level: 'error', event: 'tool_error', message: 'Tool lookup_order threw', fields: { tool: 'lookup_order', error: secret } }]);
  });

  it('keeps a failure the tool returns, and its own timeout message', async () => {
    const { logger, lines } = recorder();
    const polite = { name: 'refund', description: 'x', execute: async () => ({ success: false, message: 'That order is too old to refund.' }) };
    expect(await toolRegistry([polite]).run({ id: '1', name: 'refund', input: {} }, context(logger))).toEqual({
      success: false,
      message: 'That order is too old to refund.',
    });
    const slow = { name: 'slow', description: 'x', execute: () => new Promise<never>(() => {}) };
    expect(await toolRegistry([slow]).run({ id: '2', name: 'slow', input: {} }, { ...context(logger), timeoutMs: 5 })).toEqual({
      success: false,
      message: 'Tool execution timed out after 5ms.',
    });
    expect(lines).toEqual([]);
  });

  it('hands the logger to the tool, which lead capture uses for its callback', async () => {
    const { logger, lines } = recorder();
    const lead = new LeadCaptureTool(async () => {
      throw new Error('CRM down');
    });
    const result = await toolRegistry([lead]).run({ id: '1', name: 'capture_lead', input: { name: 'Sam', email: 'sam@acme.test', projectDetails: 'A demo' } }, context(logger));
    expect(result).toMatchObject({ success: false, message: 'Failed to process lead capture callback.' });
    expect(lines).toMatchObject([{ level: 'error', event: 'lead_capture_failed' }]);
  });
});

describe('provider warnings', () => {
  it("go to the config's logger", async () => {
    const { logger, lines } = recorder();
    // A model without an effort setting warns at once, in the constructor.
    new ClaudeProvider({ type: 'claude', apiKey: 'k', model: 'claude-old-1', effort: 'high', logger });
    expect(lines).toMatchObject([{ level: 'warn', event: 'config_warning', fields: { key: 'claude-effort-claude-old-1' } }]);
  });
});

describe('runTurn', () => {
  it('warns through its logger when a reply hits the token limit', async () => {
    const { logger, lines } = recorder();
    const provider = scriptedProvider([[
      { type: 'text-delta', delta: 'Once upon' },
      { type: 'finish', reason: 'length', usage: { inputTokens: 1, outputTokens: 16 }, parts: [{ type: 'text', text: 'Once upon' }] },
    ]]);
    const turn = runTurn({ provider, messages: [{ id: 'u', role: 'user', content: 'Tell me a story', timestamp: 0 }], systemPrompt: 'x', conversationId: 'c', logger });
    while (!(await turn.next()).done) {}
    expect(lines).toMatchObject([{ level: 'warn', event: 'reply_truncated' }]);
  });
});
