import { describe, it, expect } from 'vitest';
import { chatcopsVercelHandler } from '../../src/adapters/vercel.js';

const config = {
  provider: { type: 'claude' as const, apiKey: 'test-key' },
  systemPrompt: 'Test',
  cors: '*',
};

describe('chatcopsVercelHandler', () => {
  const handler = chatcopsVercelHandler(config);

  it('returns 405 for non-POST requests', async () => {
    const req = new Request('http://localhost/api/chat', { method: 'GET' });
    const res = await handler(req);
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body.error).toBe('Method not allowed');
  });

  it('returns 204 for OPTIONS (CORS preflight)', async () => {
    const req = new Request('http://localhost/api/chat', { method: 'OPTIONS' });
    const res = await handler(req);
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
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });
});
