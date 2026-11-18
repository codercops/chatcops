import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_SIGNATURE_TOLERANCE_SEC, WebhookDispatcher, signWebhook, verifyWebhook } from '../src/webhook.js';

describe('WebhookDispatcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches to matching webhook URLs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK', { status: 200 })
    );

    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/lead', events: ['lead:captured'] },
      { url: 'https://hooks.test/all', events: ['*'] },
    ]);

    await dispatcher.dispatch('lead:captured', { name: 'John' });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.test/lead',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.test/all',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('skips non-matching events', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK', { status: 200 })
    );

    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/lead', events: ['lead:captured'] },
    ]);

    await dispatcher.dispatch('conversation:started', {});

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retries on server errors', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return new Response('Error', { status: 500 });
      }
      return new Response('OK', { status: 200 });
    });

    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/hook', events: ['test'] },
    ]);

    await dispatcher.dispatch('test', {});

    expect(callCount).toBe(3);
  });

  it('throws on invalid URL in config', () => {
    expect(() => new WebhookDispatcher([
      { url: 'not-a-valid-url', events: ['test'] },
    ])).toThrow();
  });

  it('accepts valid URLs in config', () => {
    expect(() => new WebhookDispatcher([
      { url: 'https://hooks.test/webhook', events: ['test'] },
    ])).not.toThrow();
  });

  it('does not retry on client errors', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      return new Response('Bad Request', { status: 400 });
    });

    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/hook', events: ['test'] },
    ]);

    await dispatcher.dispatch('test', {});

    expect(callCount).toBe(1);
  });

  it('passes an AbortSignal timeout to fetch calls and preserves retry behavior', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      callCount++;
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      if (callCount < 2) {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }
      return new Response('OK', { status: 200 });
    });

    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/hook', events: ['test'] },
    ], 1000);

    await dispatcher.dispatch('test', {});

    expect(callCount).toBe(2);
  });
});

describe('verifyWebhook toleranceSec', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'lead:captured', data: { email: 'a@b.test' } });
  const secret = 'shh';
  const nowSec = 1_800_000_000;
  const now = nowSec * 1000;
  const verify = (toleranceSec: number | undefined, ageSec: number) =>
    signWebhook(body, secret, nowSec - ageSec).then((signature) => verifyWebhook({ body, signature, secret, now, ...(toleranceSec === undefined ? {} : { toleranceSec }) }));

  it('rejects a tolerance that is not a finite, non-negative whole number, with a RangeError that says which', async () => {
    const signature = await signWebhook(body, secret, nowSec);
    for (const toleranceSec of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -300, 0.5, 300.5, 2 ** 53, Number.MAX_VALUE]) {
      const call = verifyWebhook({ body, signature, secret, now, toleranceSec });
      await expect(call, String(toleranceSec)).rejects.toBeInstanceOf(RangeError);
      await expect(call, String(toleranceSec)).rejects.toThrow('toleranceSec must be a whole number of seconds, 0 or more');
    }
  });

  it('rejects values that are not numbers at all', async () => {
    const signature = await signWebhook(body, secret, nowSec);
    for (const toleranceSec of ['300', null, {}, true, [], 10n]) {
      await expect(verifyWebhook({ body, signature, secret, now, toleranceSec } as never), String(toleranceSec)).rejects.toBeInstanceOf(RangeError);
    }
  });

  it('says what it got in the message', async () => {
    const signature = await signWebhook(body, secret, nowSec);
    await expect(verifyWebhook({ body, signature, secret, now, toleranceSec: Number.NaN })).rejects.toThrow('got NaN');
    await expect(verifyWebhook({ body, signature, secret, now, toleranceSec: -5 })).rejects.toThrow('got -5');
  });

  it('checks the tolerance before the signature, so a bad setting is loud even for a bad signature or none', async () => {
    await expect(verifyWebhook({ body, signature: null, secret, now, toleranceSec: Number.NaN })).rejects.toBeInstanceOf(RangeError);
    await expect(verifyWebhook({ body, signature: 'garbage', secret, now, toleranceSec: Number.POSITIVE_INFINITY })).rejects.toBeInstanceOf(RangeError);
  });

  it('keeps the default of 300 seconds', async () => {
    expect(DEFAULT_SIGNATURE_TOLERANCE_SEC).toBe(300);
    expect(await verify(undefined, 0)).toBe(true);
    expect(await verify(undefined, 300)).toBe(true);
    expect(await verify(undefined, 301)).toBe(false);
    expect(await verify(undefined, -300)).toBe(true);
    expect(await verify(undefined, -301)).toBe(false);
  });

  it('allows 0, which takes only the signature made in the same second', async () => {
    expect(await verify(0, 0)).toBe(true);
    expect(await verify(0, 1)).toBe(false);
    expect(await verify(0, -1)).toBe(false);
  });

  it('uses a valid custom tolerance, in both directions', async () => {
    expect(await verify(60, 60)).toBe(true);
    expect(await verify(60, 61)).toBe(false);
    expect(await verify(60, -60)).toBe(true);
    expect(await verify(60, -61)).toBe(false);
    expect(await verify(3600, 3600)).toBe(true);
    expect(await verify(3600, 3601)).toBe(false);
  });

  it('accepts the largest whole number it can count', async () => {
    expect(await verify(Number.MAX_SAFE_INTEGER, 1_000_000)).toBe(true);
  });

  it('still rejects expired and future-dated signatures outside the tolerance, and a bad signature inside it', async () => {
    expect(await verify(300, 3600)).toBe(false);
    expect(await verify(300, -3600)).toBe(false);
    const signature = await signWebhook(body, secret, nowSec);
    expect(await verifyWebhook({ body, signature, secret: 'other', now, toleranceSec: 300 })).toBe(false);
    expect(await verifyWebhook({ body: `${body} `, signature, secret, now, toleranceSec: 300 })).toBe(false);
  });

  it('no longer lets NaN or Infinity switch the freshness check off', async () => {
    const stale = await signWebhook(body, secret, nowSec - 86_400);
    for (const toleranceSec of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(verifyWebhook({ body, signature: stale, secret, now, toleranceSec })).rejects.toBeInstanceOf(RangeError);
    }
  });
});
