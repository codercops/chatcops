import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatcopsCloudflareHandler } from '../../src/adapters/cloudflare.js';
import { chatcopsMiddleware } from '../../src/adapters/express.js';
import { chatcopsVercelHandler } from '../../src/adapters/vercel.js';
import { allowedOriginsOf, originPolicy } from '../../src/security/origin-policy.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('allowedOriginsOf', () => {
  it('defaults to any origin', () => {
    expect(allowedOriginsOf({})).toEqual(['*']);
  });

  it('refuses the cors option, which 1.0 removed, and an empty list', () => {
    expect(() => allowedOriginsOf({ cors: 'https://acme.com' } as never)).toThrow("Use `allowedOrigins: ['https://your.site']`");
    expect(() => allowedOriginsOf({ allowedOrigins: [] })).toThrow('`allowedOrigins` is empty');
  });
});

describe('originPolicy', () => {
  const policy = () => originPolicy({ allowedOrigins: ['https://acme.com', 'https://*.acme.dev'] });

  it('echoes an allowed origin with Vary: Origin', () => {
    expect(policy().headers('https://acme.com')).toEqual({ 'Access-Control-Allow-Origin': 'https://acme.com', Vary: 'Origin' });
    expect(policy().allows('https://staging.acme.dev')).toBe(true);
  });

  it('refuses other pages, but still lets them read the refusal', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = policy();
    expect(p.allows('https://evil.example')).toBe(false);
    expect(p.allows('https://acme.dev')).toBe(false);
    expect(p.allows('null')).toBe(false);
    expect(p.headers('https://evil.example')).toEqual({ 'Access-Control-Allow-Origin': 'https://evil.example', Vary: 'Origin' });
    p.headers('https://evil.example');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('lets requests without an Origin through, since only browsers send one', () => {
    expect(policy().allows(null)).toBe(true);
    expect(policy().headers(null)).toEqual({ Vary: 'Origin' });
  });

  it('keeps the old any-origin answer by default', () => {
    expect(originPolicy({}).headers('https://anything.example')).toEqual({ 'Access-Control-Allow-Origin': '*' });
    expect(originPolicy({}).preflightHeaders(null)).toMatchObject({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
  });
});

describe('the adapters', () => {
  const config = () => ({
    allowAnonymous: true,
    provider: scriptedProvider([textStep('Hi.')]),
    systemPrompt: 'x',
    allowedOrigins: ['https://acme.com'],
  });
  const post = (origin?: string) =>
    new Request('https://api.acme.com/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7', ...(origin ? { origin } : {}) },
      body: JSON.stringify({ conversationId: 'c1', message: 'Hello' }),
    });

  for (const [name, make] of [
    ['Vercel', chatcopsVercelHandler],
    ['Cloudflare', chatcopsCloudflareHandler],
  ] as const) {
    it(`${name}: answers an allowed site and refuses another one without calling the model`, async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const c = config();
      const handler = make(c);

      const refused = await handler(post('https://evil.example'));
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: 'origin_not_allowed' });
      expect(refused.headers.get('access-control-allow-origin')).toBe('https://evil.example');
      expect(c.provider.calls).toHaveLength(0);

      const allowed = await handler(post('https://acme.com'));
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://acme.com');
      expect(allowed.headers.get('vary')).toBe('Origin');
      expect(await allowed.text()).toContain('[DONE]');
    });
  }

  it('Express: refuses another site with 403', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = config();
    const headers: Record<string, string> = {};
    let status = 0;
    let body: unknown;
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      status: (code: number) => {
        status = code;
        return res;
      },
      json: (value: unknown) => {
        body = value;
      },
    };
    const req = { method: 'POST', headers: { origin: 'https://evil.example' }, body: { conversationId: 'c1', message: 'Hello' }, ip: '203.0.113.7' };
    await chatcopsMiddleware(c)(req as unknown as ExpressRequest, res as unknown as ExpressResponse, (() => {}) as NextFunction);

    expect(status).toBe(403);
    expect(body).toEqual({ error: 'origin_not_allowed' });
    expect(headers).toMatchObject({ 'Access-Control-Allow-Origin': 'https://evil.example', Vary: 'Origin' });
    expect(c.provider.calls).toHaveLength(0);
  });
});
