import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatcopsCloudflareHandler } from '../src/adapters/cloudflare.js';
import { chatcopsVercelHandler } from '../src/adapters/vercel.js';
import { cleanIp, cloudflareClientIp, expressClientIp, fetchClientIp, resetClientIpWarnings } from '../src/client-ip.js';

const request = (headers: Record<string, string> = {}) =>
  new Request('https://example.com/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ conversationId: crypto.randomUUID(), message: 'Hello' }),
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetClientIpWarnings();
});

describe('cleanIp', () => {
  it('keeps IPv4 and IPv6, takes the first of a list, and drops anything else', () => {
    expect(cleanIp(' 203.0.113.7 ')).toBe('203.0.113.7');
    expect(cleanIp('2001:db8::1, 10.0.0.1')).toBe('2001:db8::1');
    expect(cleanIp('::ffff:192.0.2.1')).toBe('::ffff:192.0.2.1');
    expect(cleanIp('unknown')).toBeUndefined();
    expect(cleanIp('1.2.3.4:budget:g')).toBeUndefined();
    expect(cleanIp('')).toBeUndefined();
    expect(cleanIp(null)).toBeUndefined();
  });
});

describe('fetchClientIp', () => {
  it("reads Vercel's headers on Vercel", () => {
    vi.stubEnv('VERCEL', '1');
    expect(fetchClientIp(request({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }), undefined)).toBe('203.0.113.7');
    expect(fetchClientIp(request({ 'x-real-ip': '203.0.113.8' }), undefined)).toBe('203.0.113.8');
    expect(fetchClientIp(request({ 'x-forwarded-for': '203.0.113.9' }), undefined)).toBe('203.0.113.9');
  });

  it("doesn't trust X-Forwarded-For anywhere else, and warns once", () => {
    vi.stubEnv('VERCEL', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(fetchClientIp(request({ 'x-forwarded-for': '6.6.6.6' }), undefined)).toBeUndefined();
    expect(fetchClientIp(request({ 'x-forwarded-for': '7.7.7.7' }), undefined)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('`clientIp`');
  });

  it('uses clientIp when set, on any host', () => {
    vi.stubEnv('VERCEL', '1');
    const clientIp = (r: Request) => r.headers.get('x-nf-client-connection-ip');
    expect(fetchClientIp(request({ 'x-nf-client-connection-ip': '198.51.100.4', 'x-vercel-forwarded-for': '1.1.1.1' }), clientIp)).toBe('198.51.100.4');
    expect(fetchClientIp(request(), clientIp)).toBeUndefined();
  });
});

describe('cloudflareClientIp', () => {
  it('reads CF-Connecting-IP and ignores X-Forwarded-For', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(cloudflareClientIp(request({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '6.6.6.6' }), undefined)).toBe('203.0.113.7');
    expect(cloudflareClientIp(request({ 'x-forwarded-for': '6.6.6.6' }), undefined)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('expressClientIp', () => {
  it("uses req.ip, and warns once when there's a proxy header but trust proxy is off", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = (trust: unknown) => ({ get: (setting: string) => (setting === 'trust proxy' ? trust : undefined) });

    expect(expressClientIp({ ip: '203.0.113.7', headers: {}, app: app(false) })).toBe('203.0.113.7');
    expect(warn).not.toHaveBeenCalled();
    expect(expressClientIp({ ip: '10.0.0.2', headers: { 'x-forwarded-for': '203.0.113.7' }, app: app(1) })).toBe('10.0.0.2');
    expect(warn).not.toHaveBeenCalled();

    expressClientIp({ ip: '10.0.0.2', headers: { 'x-forwarded-for': '203.0.113.7' }, app: app(false) });
    expressClientIp({ ip: '10.0.0.2', headers: { 'x-forwarded-for': '203.0.113.8' }, app: app(false) });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("app.set('trust proxy', 1)");
  });

  it('falls back to the socket address, and never to a shared placeholder', () => {
    expect(expressClientIp({ socket: { remoteAddress: '::1' }, headers: {} })).toBe('::1');
    expect(expressClientIp({ socket: {}, headers: {} })).toBeUndefined();
  });
});

describe('the fetch handlers', () => {
  const config = () => ({
    allowAnonymous: true,
    provider: scriptedProvider(Array.from({ length: 4 }, () => textStep('ok'))),
    systemPrompt: 'x',
    rateLimit: { maxRequests: 1, windowMs: 60_000 },
  });

  it('rate limits a spoofed X-Forwarded-For on Vercel by the real IP', async () => {
    vi.stubEnv('VERCEL', '1');
    const handler = chatcopsVercelHandler(config());
    const first = await (await handler(request({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }))).text();
    const second = await (await handler(request({ 'x-vercel-forwarded-for': '203.0.113.7', 'x-forwarded-for': '2.2.2.2' }))).text();
    expect(first).toContain('[DONE]');
    expect(second).toContain('rate_limit');
  });

  it("doesn't let a visitor pick their own rate limit key off Vercel", async () => {
    vi.stubEnv('VERCEL', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const handler = chatcopsVercelHandler({ allowAnonymous: true, ...config(), clientIp: (r) => r.headers.get('x-test-socket-ip') });
    await (await handler(request({ 'x-test-socket-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1' }))).text();
    const second = await (await handler(request({ 'x-test-socket-ip': '203.0.113.7', 'x-forwarded-for': '2.2.2.2' }))).text();
    expect(second).toContain('rate_limit');
  });

  it('limits Workers requests by CF-Connecting-IP', async () => {
    const handler = chatcopsCloudflareHandler(config());
    await (await handler(request({ 'cf-connecting-ip': '203.0.113.7' }))).text();
    expect(await (await handler(request({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '9.9.9.9' }))).text()).toContain('rate_limit');
    expect(await (await handler(request({ 'cf-connecting-ip': '203.0.113.8' }))).text()).toContain('[DONE]');
  });
});
