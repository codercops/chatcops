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
  it('sends an id, type and created time, and signs the raw body', async () => {
    const calls = captureFetch([]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/lead', events: ['lead:captured'], secret: 'shh' }]);

    await dispatcher.dispatch('lead:captured', { email: 'a@b.test' });

    const body = calls[0].init.body as string;
    const event = JSON.parse(body) as WebhookEvent;
    expect(event).toEqual({ id: expect.any(String), type: 'lead:captured', created: expect.any(Number), data: { email: 'a@b.test' } });
    expect(event.id).toMatch(/^evt_[0-9a-f-]{36}$/);
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
  it('keeps the default timeout and three total attempts when overrides are omitted', async () => {
    vi.useFakeTimers();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const calls = captureFetch([
      new Response('', { status: 500 }),
      new Response('', { status: 500 }),
      new Response('', { status: 200 }),
    ]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/defaults', events: ['*'] }]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.runAllTimersAsync();
    await done;

    expect(calls).toHaveLength(3);
    expect(timeoutSpy.mock.calls.map(([timeoutMs]) => timeoutMs)).toEqual([5000, 5000, 5000]);
  });

  it('applies each webhook timeout to every attempt and stops at its own attempt limit', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const attempts = new Map<string, number>();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const endpoint = String(url);
      const attempt = (attempts.get(endpoint) ?? 0) + 1;
      attempts.set(endpoint, attempt);
      return new Response('', { status: 500 });
    });
    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/single', events: ['*'], timeoutMs: 100, maxAttempts: 1 },
      { url: 'https://hooks.test/retry', events: ['*'], timeoutMs: 200, maxAttempts: 2 },
    ]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.runAllTimersAsync();
    await done;

    expect(attempts.get('https://hooks.test/single')).toBe(1);
    expect(attempts.get('https://hooks.test/retry')).toBe(2);
    expect(timeoutSpy.mock.calls.map(([timeoutMs]) => timeoutMs)).toEqual([100, 200, 200]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'rejects invalid timeoutMs value %s',
    (timeoutMs) => {
      expect(() => new WebhookDispatcher([{ url: 'https://hooks.test/lead', events: ['*'], timeoutMs }])).toThrow(
        'webhook.timeoutMs must be an integer between 1 and 2147483647'
      );
    }
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, 11])(
    'rejects invalid maxAttempts value %s',
    (maxAttempts) => {
      expect(() => new WebhookDispatcher([{ url: 'https://hooks.test/lead', events: ['*'], maxAttempts }])).toThrow(
        'webhook.maxAttempts must be an integer between 1 and 10'
      );
    }
  );

  it('allows the maximum of 10 attempts', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = captureFetch(Array.from({ length: 10 }, () => new Response('', { status: 500 })));
    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/maximum-attempts', events: ['*'], maxAttempts: 10 },
    ]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.runAllTimersAsync();
    await done;

    expect(calls).toHaveLength(10);
  });

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

  it('parses HTTP-date Retry-After values and caps their delay at 10 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T14:00:00.000Z'));
    const calls = captureFetch([
      new Response('', {
        status: 429,
        headers: { 'Retry-After': new Date(Date.now() + 5_000).toUTCString() },
      }),
      new Response('', {
        status: 429,
        headers: { 'Retry-After': new Date(Date.now() + 30_000).toUTCString() },
      }),
      new Response('', { status: 200 }),
    ]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/date', events: ['*'] }]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.advanceTimersByTimeAsync(4_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(calls).toHaveLength(3);
  });

  it('waits for a fractional Retry-After in seconds', async () => {
    vi.useFakeTimers();
    const calls = captureFetch([
      new Response('', { status: 429, headers: { 'Retry-After': '1.5' } }),
      new Response('', { status: 200 }),
    ]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/fraction', events: ['*'] }]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.advanceTimersByTimeAsync(1_499);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(calls).toHaveLength(2);
  });

  it('retries immediately for a past HTTP-date Retry-After value', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T14:00:00.000Z'));
    const calls = captureFetch([
      new Response('', {
        status: 429,
        headers: { 'Retry-After': 'Sat, 31 Oct 2026 13:59:59 GMT' },
      }),
      new Response('', { status: 200 }),
    ]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/past-date', events: ['*'] }]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.advanceTimersByTimeAsync(0);
    await done;
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['invalid', 'not a valid HTTP date'],
    ['missing', null],
    // Both of these are dates long past to Date.parse, which would retry at once.
    ['negative', '-1'],
    ['numbers with no day or month name', '1 2'],
  ])('%s Retry-After uses the exponential fallback', async (_label, retryAfter) => {
    vi.useFakeTimers();
    const headers = retryAfter ? { 'Retry-After': retryAfter } : {};
    const calls = captureFetch([
      new Response('', { status: 429, headers }),
      new Response('', { status: 200 }),
    ]);
    const dispatcher = new WebhookDispatcher([{ url: 'https://hooks.test/fallback', events: ['*'] }]);

    const done = dispatcher.dispatch('lead:captured', {});
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(calls).toHaveLength(2);
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
    'https://localhost./hook',
    'https://widget.localhost./hook',
    'https://127.0.0.1/hook',
    'https://10.0.0.5/hook',
    'https://172.16.3.4/hook',
    'https://192.168.1.10/hook',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/hook',
    'https://[fd00::1]/hook',
    'https://[::ffff:10.0.0.1]/hook',
    'https://metadata.google.internal/computeMetadata',
    'https://metadata.google.internal./computeMetadata',
    'ftp://hooks.example.com/lead',
  ])('refuses %s', (url) => {
    expect(() => assertSafeWebhookUrl(url)).toThrow();
    expect(() => new WebhookDispatcher([{ url, events: ['*'] }])).toThrow();
  });

  it.each([
    'https://hooks.example.com/lead',
    'https://hooks.example.com./lead',
    'https://8.8.8.8/hook',
    'https://172.32.0.1/hook',
    'https://[2606:4700::1]/hook',
  ])(
    'accepts %s',
    (url) => {
      expect(() => assertSafeWebhookUrl(url)).not.toThrow();
    }
  );

  it('keeps a public hostname trailing dot in the returned delivery URL', () => {
    expect(assertSafeWebhookUrl('https://hooks.example.com./lead').hostname).toBe('hooks.example.com.');
  });

  it('allows a local http receiver with allowPrivateNetwork', () => {
    expect(() => new WebhookDispatcher([{ url: 'http://localhost:4000/hook', events: ['*'], allowPrivateNetwork: true }])).not.toThrow();
    expect(() => assertSafeWebhookUrl('file:///etc/passwd', true)).toThrow();
  });
});
