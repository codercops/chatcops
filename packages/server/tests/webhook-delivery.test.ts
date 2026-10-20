import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WebhookDispatcher,
  assertSafeWebhookUrl,
  signWebhook,
  verifyWebhook,
  SIGNATURE_HEADER,
  type WebhookEvent,
} from '../src/webhook.js';

type Call = { url: string; init: RequestInit };
function captureFetch(responses: Array<Response | Error>) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    calls.push({ url: String(url), init: init! });
    const next = responses.shift() ?? new Response('OK', { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  });
  return calls;
}
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('webhook envelope and signature', () => {
  it('sends an id, type and created time, plus the old fields, and signs the raw body', async () => {
    const calls = captureFetch([]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/lead', events: ['lead:captured'], secret: 'shh' }]);

    await dispatcher.dispatch('lead:captured', { email: 'a@b.test' });

    const body = calls[0].init.body as string;
    const event = JSON.parse(body) as WebhookEvent;
    expect(event).toMatchObject({ type: 'lead:captured', event: 'lead:captured', data: { email: 'a@b.test' } });
    expect(event.id).toMatch(/^evt_[0-9a-f-]{36}$/);
    expect(event.timestamp).toBe(event.created);
    expect(body).not.toContain('signature');
    expect(header(calls[0], 'X-ChatCops-Event-Id')).toBe(event.id);
    expect(calls[0].init.redirect).toBe('manual');

    const signature = header(calls[0], SIGNATURE_HEADER);
    expect(signature).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(await verifyWebhook({ body, signature, secret: 'shh' })).toBe(true);
  });

  it('rejects a tampered body, a wrong secret, a stale timestamp and a missing header', async () => {
    const body = JSON.stringify({ id: 'evt_1', type: 'lead:captured', data: { email: 'a@b.test' } });
    const now = Date.now();
    const signature = await signWebhook(body, 'shh', Math.floor(now / 1000));

    expect(await verifyWebhook({ body, signature, secret: 'shh', now })).toBe(true);
    expect(await verifyWebhook({ body: body.replace('a@b', 'x@y'), signature, secret: 'shh', now })).toBe(false);
    expect(await verifyWebhook({ body, signature, secret: 'other', now })).toBe(false);
    expect(await verifyWebhook({ body, signature, secret: 'shh', now: now + 301_000 })).toBe(false);
    expect(await verifyWebhook({ body, signature: null, secret: 'shh', now })).toBe(false);
    expect(await verifyWebhook({ body, signature: 'v1=abc', secret: 'shh', now })).toBe(false);
  });

  it('keeps the same event id on every retry', async () => {
    vi.useFakeTimers();
    const calls = captureFetch([new Response('', { status: 503 }), new Response('', { status: 200 })]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/lead', events: ['*'] }]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.runAllTimersAsync();
    await done;

    expect(calls).toHaveLength(2);
    expect(header(calls[0], 'X-ChatCops-Event-Id')).toBe(header(calls[1], 'X-ChatCops-Event-Id'));
  });
});

describe('webhook retries', () => {
  it('retries 429 and waits for Retry-After, capped at 10 seconds', async () => {
    vi.useFakeTimers();
    const calls = captureFetch([
      new Response('', { status: 429, headers: { 'Retry-After': '3' } }),
      new Response('', { status: 429, headers: { 'Retry-After': '120' } }),
      new Response('', { status: 200 }),
    ]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/lead', events: ['*'] }]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.advanceTimersByTimeAsync(2_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(calls).toHaveLength(3);
  });

  it("doesn't retry other client errors, and logs the failure without the body or secret", async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = captureFetch([new Response('', { status: 400 })]);
    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/lead?token=abc', events: ['*'], secret: 'super-secret' },
    ]);

    await dispatcher.dispatch('lead:captured', { email: 'private@person.test' });

    expect(calls).toHaveLength(1);
    expect(error).toHaveBeenCalledOnce();
    const line = String(error.mock.calls[0][0]);
    expect(line).toContain('lead:captured');
    expect(line).toContain('https://hooks.test');
    expect(line).toContain('HTTP 400');
    for (const secret of ['private@person.test', 'super-secret', 'token=abc']) expect(line).not.toContain(secret);
  });

  it('logs once after the last network failure', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = captureFetch([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/lead', events: ['*'] }]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.runAllTimersAsync();
    await done;

    expect(calls).toHaveLength(3);
    expect(error).toHaveBeenCalledOnce();
  });

  it('treats a redirect as a failure instead of following it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = captureFetch([new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/' } })]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/lead', events: ['*'] }]);

    await dispatcher.dispatch('lead:captured', {});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://hooks.test/lead');
  });
});

describe('webhook URL guard', () => {
  it.each([
    'http://hooks.example.com/lead',
    'https://localhost/hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://172.16.3.4/hook',
    'https://192.168.1.10/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[fd00::1]/hook',
    'https://[::ffff:10.0.0.1]/hook',
    'https://metadata.google.internal/computeMetadata',
    'ftp://hooks.example.com/lead',
  ])('refuses %s', (url) => {
    expect(() => assertSafeWebhookUrl(url)).toThrow();
    expect(() => new WebhookDispatcher([{ url, events: ['*'] }])).toThrow();
  });

  it.each(['https://hooks.example.com/lead', 'https://8.8.8.8/hook', 'https://172.32.0.1/hook', 'https://[2606:4700::1]/hook'])(
    'accepts %s',
    (url) => {
      expect(() => assertSafeWebhookUrl(url)).not.toThrow();
    }
  );

  it('allows a local http receiver with allowPrivateNetwork', () => {
    expect(() => new WebhookDispatcher([{ url: 'http://localhost:4000/hook', events: ['*'], allowPrivateNetwork: true }])).not.toThrow();
    expect(() => assertSafeWebhookUrl('file:///etc/passwd', true)).toThrow();
  });
});
