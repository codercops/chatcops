import { describe, expect, it } from 'vitest';
import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { chatcopsNext } from '../../src/adapters/next.js';

const SECRET = 'a-session-secret-that-is-long-enough-for-chatcops';
const SITE = 'https://acme.com';

describe('chatcopsNext', () => {
  const provider = scriptedProvider(Array.from({ length: 10 }, () => textStep('Hello from Next.js')));
  const { POST, OPTIONS } = chatcopsNext({
    provider,
    systemPrompt: 'You are a helpful assistant.',
    allowedOrigins: [SITE],
    sessionSecrets: [SECRET],
    clientIp: () => '127.0.0.1',
  });

  it('handles OPTIONS preflight with 204 and CORS headers', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'OPTIONS',
      headers: { Origin: SITE },
    });
    const res = await OPTIONS(req);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(SITE);
  });

  it('handles session POST to /api/chat/session and mints a session token', async () => {
    const req = new Request('http://localhost/api/chat/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: SITE,
      },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; conversationId: string; expiresAt: number };
    expect(body.token).toBeTypeOf('string');
    expect(body.conversationId).toBeTypeOf('string');
    expect(body.expiresAt).toBeTypeOf('number');
  });

  it('returns 401 when chat POST to /api/chat is missing a session token', async () => {
    const req = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: SITE,
      },
      body: JSON.stringify({ protocol: 1, conversationId: 'c1', message: 'Hello' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('session_required');
  });

  it('handles chat POST to /api/chat with a valid session token and streams the response', async () => {
    const sessionReq = new Request('http://localhost/api/chat/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: SITE,
      },
      body: JSON.stringify({}),
    });
    const sessionRes = await POST(sessionReq);
    const sessionData = (await sessionRes.json()) as { token: string; conversationId: string };

    const chatReq = new Request('http://localhost/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: SITE,
        Authorization: `Bearer ${sessionData.token}`,
      },
      body: JSON.stringify({
        protocol: 1,
        conversationId: sessionData.conversationId,
        message: 'Hello',
      }),
    });
    const chatRes = await POST(chatReq);
    expect(chatRes.status).toBe(200);
    expect(chatRes.headers.get('Content-Type')).toContain('text/event-stream');
    const text = await chatRes.text();
    expect(text).toContain('Hello');
    expect(text).toContain('[DONE]');
  });
});
