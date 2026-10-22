import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { memoryStorage, type WirePart } from '@chatcops/core';
import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { chatcopsVercelHandler } from '../src/adapters/vercel.js';
import { chatcopsMiddleware } from '../src/adapters/express.js';
import { createSessions, SESSION_RESUME_GRACE_SEC } from '../src/security/sessions.js';
import type { ChatCopsServerConfig } from '../src/config.js';

const SECRET = 'a-session-secret-that-is-long-enough-1';
const OLD_SECRET = 'an-older-session-secret-still-verifying';
const SITE = 'https://acme.com';

/** A /session reply: a token, or an error. */
interface SessionBody {
  token: string;
  expiresAt: number;
  conversationId: string;
  error: { code: string };
}

function setup(overrides: Partial<ChatCopsServerConfig> = {}) {
  const provider = scriptedProvider(Array.from({ length: 10 }, () => textStep('Hello')));
  const handler = chatcopsVercelHandler({
    provider,
    systemPrompt: 'Test',
    budgets: false,
    clientIp: () => '203.0.113.7',
    allowedOrigins: [SITE, 'https://other.example'],
    sessionSecrets: [SECRET],
    ...overrides,
  });

  async function session(body: unknown = {}, origin = SITE) {
    const res = await handler(
      new Request('http://localhost/api/chat/session', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Origin: origin },
      })
    );
    return { status: res.status, body: (await res.json()) as SessionBody, headers: res.headers };
  }

  async function chat(conversationId: string, token?: string, options: { origin?: string; protocol?: number } = {}) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Origin: options.origin ?? SITE };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await handler(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ protocol: options.protocol ?? 1, conversationId, message: 'Hi' }),
        headers,
      })
    );
    return { status: res.status, text: await res.text() };
  }

  return { provider, session, chat };
}

function partsOf(text: string): WirePart[] {
  return text
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: {'))
    .map((frame) => JSON.parse(frame.slice(6)) as WirePart);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /session', () => {
  it('gives a fresh conversation a token that its chat requests can use', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const { session, chat } = setup();

    const minted = await session();
    expect(minted.status).toBe(200);
    expect(minted.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(minted.body.conversationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(minted.body.expiresAt).toBe(1_800_000_000_000 + 900_000);

    const reply = await chat(minted.body.conversationId, minted.body.token);
    expect(reply.status).toBe(200);
    expect(partsOf(reply.text)[0]).toMatchObject({ type: 'start', capabilities: { session: true } });
  });

  it("gives out an id with nothing stored, but never one that has messages", async () => {
    const { session, chat } = setup();
    const fresh = await session({ conversationId: 'made-up-by-the-widget' });
    expect(fresh.body.conversationId).toBe('made-up-by-the-widget');
    expect((await chat('made-up-by-the-widget', fresh.body.token)).status).toBe(200);

    const guessed = await session({ conversationId: 'made-up-by-the-widget' });
    expect(guessed.status).toBe(200);
    expect(guessed.body.conversationId).not.toBe('made-up-by-the-widget');

    const forged = await session({ conversationId: 'made-up-by-the-widget', previousToken: 'eyJ.bad.token' });
    expect(forged.body.conversationId).not.toBe('made-up-by-the-widget');
  });

  it('resumes a conversation with its previous token, even expired, within the grace window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    // A store that keeps the conversation past the grace window.
    const { session, chat } = setup({ storage: memoryStorage({ conversationTtlMs: 365 * 86_400_000 }) });
    const first = await session();
    await chat(first.body.conversationId, first.body.token);

    vi.setSystemTime(1_800_000_000_000 + 7 * 86_400_000);
    const resumed = await session({ conversationId: first.body.conversationId, previousToken: first.body.token });
    expect(resumed.body.conversationId).toBe(first.body.conversationId);
    expect(resumed.body.token).not.toBe(first.body.token);

    vi.setSystemTime(1_800_000_000_000 + (900 + SESSION_RESUME_GRACE_SEC + 120) * 1000);
    const late = await session({ conversationId: first.body.conversationId, previousToken: first.body.token });
    expect(late.body.conversationId).not.toBe(first.body.conversationId);
  });

  it("doesn't resume with a token from another site, or for another conversation", async () => {
    const { session, chat } = setup();
    const first = await session();
    const second = await session();

    // Only ids with messages are protected, so give the first conversation one.
    await chat(first.body.conversationId, first.body.token);
    const elsewhere = await session({ conversationId: first.body.conversationId, previousToken: first.body.token }, 'https://other.example');
    expect(elsewhere.body.conversationId).not.toBe(first.body.conversationId);

    const swapped = await session({ conversationId: first.body.conversationId, previousToken: second.body.token });
    expect(swapped.body.conversationId).not.toBe(first.body.conversationId);
  });

  it('refuses a body it cannot read, and other sites', async () => {
    const { session } = setup();
    expect((await session({ conversationId: 42 })).status).toBe(400);
    expect((await session([])).status).toBe(400);
    expect((await session({ previousToken: 'x'.repeat(5000) })).status).toBe(400);
    expect((await session({ turnstileToken: 7 })).status).toBe(400);
    expect((await session({ idempotencyKey: 'x'.repeat(200) })).status).toBe(400);
    expect((await session({}, 'https://evil.example')).status).toBe(403);
  });

  it('is 404 when session tokens are off', async () => {
    const { session } = setup({ sessionSecrets: undefined });
    const res = await session();
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('invalid_request');
  });
});

describe('chat requests with session tokens on', () => {
  it('need a token: 401 session_required, before the model is called', async () => {
    const { chat, provider } = setup();
    const res = await chat('c1');
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).error.code).toBe('session_required');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuse a 0.5 request without a token inside its 200 stream', async () => {
    const { chat } = setup();
    const res = await chat('c1', undefined, { protocol: 0 });
    expect(res.status).toBe(200);
    expect(res.text).toContain('"error":"provider_error"');
  });

  it("refuse another conversation's id with your token: 401 conversation_mismatch", async () => {
    const { session, chat, provider } = setup();
    const mine = await session();
    const res = await chat('someone-elses-conversation', mine.body.token);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).error.code).toBe('conversation_mismatch');
    expect(provider.calls).toHaveLength(0);
  });

  it('refuse an expired token with token_expired, so the widget fetches a new one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_800_000_000_000);
    const { session, chat } = setup();
    const minted = await session();
    vi.setSystemTime(1_800_000_000_000 + 2 * 900_000);
    const res = await chat(minted.body.conversationId, minted.body.token);
    expect(res.status).toBe(401);
    expect(JSON.parse(res.text).error.code).toBe('token_expired');
  });

  it("refuse a token from another site, or one that isn't signed by us", async () => {
    const { session, chat } = setup();
    const minted = await session();
    const elsewhere = await chat(minted.body.conversationId, minted.body.token, { origin: 'https://other.example' });
    expect(JSON.parse(elsewhere.text).error.code).toBe('session_required');

    const other = setup({ sessionSecrets: ['a-different-secret-that-is-long-enough'] });
    const foreign = await other.session();
    const forged = await chat(foreign.body.conversationId, foreign.body.token);
    expect(forged.status).toBe(401);
    expect(JSON.parse(forged.text).error.code).toBe('session_required');
  });

  it('accept tokens signed with an older secret while it is still listed', async () => {
    const before = setup({ sessionSecrets: [OLD_SECRET] });
    const minted = await before.session();
    const after = setup({ sessionSecrets: [SECRET, OLD_SECRET] });
    expect((await after.chat(minted.body.conversationId, minted.body.token)).status).toBe(200);
  });

  it('let requests without a token through with requireSession: false, but still check the ones that send one', async () => {
    const { session, chat } = setup({ requireSession: false });
    expect((await chat('anonymous')).status).toBe(200);
    const minted = await session();
    expect((await chat('not-the-token-conversation', minted.body.token)).status).toBe(401);
  });
});

describe('Turnstile when a session is issued', () => {
  const turnstile = { secretKey: '1x0000000000000000000000000000000AA' };

  function siteverify(...replies: Array<Record<string, unknown> | Error>) {
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const reply of replies) {
      if (reply instanceof Error) fetch.mockRejectedValueOnce(reply);
      else fetch.mockResolvedValueOnce(new Response(JSON.stringify(reply), { status: 200 }));
    }
    return fetch;
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checks the token with Cloudflare, with the IP and idempotency key, before signing', async () => {
    const fetch = siteverify({ success: true, hostname: 'acme.com' });
    const { session } = setup({ turnstile });
    const minted = await session({ turnstileToken: 'XXXX.DUMMY.TOKEN', idempotencyKey: 'f0e4c2f7-6a2b-4d3c-9f1e-2a7b8c9d0e1f' });

    expect(minted.status).toBe(200);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(JSON.parse(String(init?.body))).toEqual({
      secret: turnstile.secretKey,
      response: 'XXXX.DUMMY.TOKEN',
      remoteip: '203.0.113.7',
      idempotency_key: 'f0e4c2f7-6a2b-4d3c-9f1e-2a7b8c9d0e1f',
    });
  });

  it('refuses a missing or failed token with 401 turnstile_failed', async () => {
    const fetch = siteverify({ success: false, 'error-codes': ['invalid-input-response'] });
    const { session } = setup({ turnstile });

    const missing = await session({});
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('turnstile_failed');
    expect(fetch).not.toHaveBeenCalled();

    const failed = await session({ turnstileToken: 'bad' });
    expect(failed.status).toBe(401);
    expect(failed.body.error.code).toBe('turnstile_failed');
  });

  it('answers 503 when Cloudflare cannot be reached, without issuing a token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    siteverify(new Error('offline'));
    const { session } = setup({ turnstile });
    const res = await session({ turnstileToken: 'XXXX.DUMMY.TOKEN' });
    expect(res.status).toBe(503);
    expect(res.body.token).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Turnstile could not be reached'));
  });

  it('skips Turnstile when a session is refreshed with its previous token', async () => {
    const fetch = siteverify({ success: true });
    const { session } = setup({ turnstile });
    const first = await session({ turnstileToken: 'XXXX.DUMMY.TOKEN' });
    const refreshed = await session({ conversationId: first.body.conversationId, previousToken: first.body.token });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.conversationId).toBe(first.body.conversationId);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('needs sessionSecrets and a secret key', () => {
    expect(() => createSessions({ turnstile })).toThrow('needs `sessionSecrets`');
    expect(() => createSessions({ sessionSecrets: [SECRET], turnstile: { secretKey: '' } })).toThrow('needs its `secretKey`');
  });
});

describe('the Express middleware', () => {
  function run(config: ChatCopsServerConfig, path: string, body: unknown, headers: Record<string, string> = {}) {
    const chunks: string[] = [];
    const res = {
      writableFinished: false,
      statusCode: 200,
      jsonBody: undefined as unknown as SessionBody,
      setHeader: vi.fn(),
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(value: unknown) {
        this.jsonBody = value;
      },
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
      end: vi.fn(),
      on: vi.fn(),
    };
    const req = { method: 'POST', path, body, ip: '127.0.0.1', socket: {}, headers };
    return chatcopsMiddleware(config)(req as unknown as ExpressRequest, res as unknown as ExpressResponse, vi.fn() as unknown as NextFunction).then(() => ({ res, chunks }));
  }

  it('answers /session under its mount path and checks the token on chat requests', async () => {
    const config: ChatCopsServerConfig = {
      provider: scriptedProvider([textStep('Hello')]),
      systemPrompt: 'Test',
      budgets: false,
      sessionSecrets: [SECRET],
    };
    const minted = await run(config, '/session', {});
    expect(minted.res.statusCode).toBe(200);
    const { conversationId, token } = minted.res.jsonBody;

    const refused = await run(config, '/', { protocol: 1, conversationId, message: 'Hi' });
    expect(refused.res.statusCode).toBe(401);

    const ok = await run(config, '/', { protocol: 1, conversationId, message: 'Hi' }, { authorization: `Bearer ${token}` });
    expect(ok.res.statusCode).toBe(200);
    expect(ok.chunks.join('')).toContain('"session":true');
  });

  it('is 404 at /session when session tokens are off', async () => {
    const off = await run({ provider: scriptedProvider([]), systemPrompt: 'Test', budgets: false }, '/session', {});
    expect(off.res.statusCode).toBe(404);
  });
});

describe('session config', () => {
  it('fails at startup on a secret that is too short, or none at all', () => {
    expect(() => createSessions({ sessionSecrets: ['short'] })).toThrow('sessionSecrets[0] is 5 bytes; it needs at least 32');
    expect(() => createSessions({ sessionSecrets: [] })).toThrow('at least one secret');
    expect(() => createSessions({ requireSession: true })).toThrow('needs `sessionSecrets`');
    expect(() => createSessions({ sessionSecrets: [SECRET], sessionTtlSec: 0 })).toThrow('sessionTtlSec');
    expect(createSessions({})).toBeUndefined();
  });

  it('reads the Bearer scheme in any case', async () => {
    const sessions = createSessions({ sessionSecrets: [SECRET] });
    if (!sessions) throw new Error('sessions should be on');
    const minted = await sessions.mint({}, SITE);
    const { token, conversationId } = minted.body as SessionBody;
    expect(await sessions.check(`bearer ${token}`, SITE, conversationId)).toMatchObject({ ok: true });
    expect(await sessions.check(`Basic ${token}`, SITE, conversationId)).toMatchObject({ ok: false, code: 'session_required' });
  });
});
