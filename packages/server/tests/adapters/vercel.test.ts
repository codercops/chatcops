import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/handler.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/handler.js')>();
  return {
    ...actual,
    createChatHandler: vi.fn(actual.createChatHandler),
  };
});

import { createChatHandler } from '../../src/handler.js';
import { chatcopsVercelHandler } from '../../src/adapters/vercel.js';

const config = {
  allowAnonymous: true,
  provider: { type: 'claude' as const, apiKey: 'test-key' },
  systemPrompt: 'Test',
  allowedOrigins: ['*'],
};

describe('chatcopsVercelHandler', () => {
  const handler = chatcopsVercelHandler(config);

  it('returns 405 for non-POST requests', async () => {
    const req = new Request('http://localhost/api/chat', { method: 'GET' });
    const res = await handler(req);
    expect(res.status).toBe(405);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Allow')).toBe('POST, OPTIONS');
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });

  it('returns Access-Control-Allow-Origin: * for 405 when cors is not configured', async () => {
    const handlerWithoutCors = chatcopsVercelHandler({
      allowAnonymous: true,
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
    });
    const req = new Request('http://localhost/api/chat', { method: 'GET' });
    const res = await handlerWithoutCors(req);
    expect(res.status).toBe(405);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });

  it('returns custom Access-Control-Allow-Origin for 405 when cors is configured', async () => {
    const handlerWithCustomCors = chatcopsVercelHandler({
      allowAnonymous: true,
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
      allowedOrigins: ['https://example.com'],
    });
    const req = new Request('http://localhost/api/chat', { method: 'GET', headers: { Origin: 'https://example.com' } });
    const res = await handlerWithCustomCors(req);
    expect(res.status).toBe(405);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });

  it('returns 204 for OPTIONS (CORS preflight)', async () => {
    const req = new Request('http://localhost/api/chat', { method: 'OPTIONS' });
    const res = await handler(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns Access-Control-Allow-Origin: * for OPTIONS when cors is not configured', async () => {
    const handlerWithoutCors = chatcopsVercelHandler({
      allowAnonymous: true,
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
    });
    const req = new Request('http://localhost/api/chat', { method: 'OPTIONS' });
    const res = await handlerWithoutCors(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 400 for malformed JSON body', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: 'not valid json{{{',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await handler(req);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns Access-Control-Allow-Origin: * for 400 when cors is not configured', async () => {
    const handlerWithoutCors = chatcopsVercelHandler({
      allowAnonymous: true,
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
    });
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: 'not valid json{{{',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await handlerWithoutCors(req);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns custom Access-Control-Allow-Origin for 400 when cors is configured', async () => {
    const handlerWithCustomCors = chatcopsVercelHandler({
      allowAnonymous: true,
      provider: { type: 'claude' as const, apiKey: 'test-key' },
      systemPrompt: 'Test',
      allowedOrigins: ['https://example.com'],
    });
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      body: 'not valid json{{{',
      headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' },
    });
    const res = await handlerWithCustomCors(req);
    expect(res.status).toBe(400);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  describe('when the chat handler throws', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('logs the error and still streams internal_error', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const failure = new Error('Unexpected handler failure');
      vi.mocked(createChatHandler).mockImplementationOnce(() => ({
        startChat: async () => {
          throw failure;
        },
        getAnalytics: () => null,
        cleanup: () => undefined,
      }));

      const failing = chatcopsVercelHandler(config);
      const res = await failing(
        new Request('http://localhost/api/chat', {
          method: 'POST',
          body: JSON.stringify({ conversationId: 'log-test', message: 'secret message' }),
        }),
      );
      const text = await res.text();

      expect(text).toBe(`data: ${JSON.stringify({ error: 'internal_error' })}\n\n`);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[chatcops]'), failure);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret message');
    });
  });
});
