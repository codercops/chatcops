import { afterEach, describe, expect, it, vi } from 'vitest';
import { postWithRetries } from '../../src/retrieval/http.js';

const post = { url: 'https://provider.test', headers: {}, body: {} };

function response(status: number, retryAfter?: string): Response {
  const headers = retryAfter === undefined ? undefined : { 'retry-after': retryAfter };
  return new Response('', { status, headers });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('postWithRetries Retry-After', () => {
  it('waits the requested number of seconds for delay-seconds values', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValueOnce(response(429, '2')).mockResolvedValueOnce(new Response('ok'));
    const result = postWithRetries('Provider', send, post);

    await vi.advanceTimersByTimeAsync(1999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBeInstanceOf(Response);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['1.5', 1500],
    ['120.5', 30_000],
  ])('treats numeric value %s as seconds instead of parsing it as a date', async (value, delayMs) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
    const send = vi.fn().mockResolvedValueOnce(response(429, value)).mockResolvedValueOnce(new Response('ok'));
    const result = postWithRetries('Provider', send, post);

    await vi.advanceTimersByTimeAsync(delayMs - 1);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('uses exponential backoff for a negative numeric value', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValueOnce(response(429, '-1')).mockResolvedValueOnce(new Response('ok'));
    const result = postWithRetries('Provider', send, post);

    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('waits until a future HTTP date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
    const retryAt = new Date(Date.now() + 5_000).toUTCString();
    const send = vi.fn().mockResolvedValueOnce(response(503, retryAt)).mockResolvedValueOnce(new Response('ok'));
    const result = postWithRetries('Provider', send, post);

    await vi.advanceTimersByTimeAsync(4999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries immediately for a past HTTP date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
    const send = vi.fn().mockResolvedValueOnce(response(429, 'Sat, 31 Oct 2026 23:59:59 GMT')).mockResolvedValueOnce(new Response('ok'));

    const result = postWithRetries('Provider', send, post);
    await vi.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBeInstanceOf(Response);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('caps HTTP-date delays at 30 seconds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
    const retryAt = new Date(Date.now() + 60_000).toUTCString();
    const send = vi.fn().mockResolvedValueOnce(response(503, retryAt)).mockResolvedValueOnce(new Response('ok'));
    const result = postWithRetries('Provider', send, post);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, 'not a date'])('uses exponential backoff for a missing or invalid value (%s)', async (retryAfter) => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValueOnce(response(429, retryAfter)).mockResolvedValueOnce(new Response('ok'));
    const result = postWithRetries('Provider', send, post);

    await vi.advanceTimersByTimeAsync(999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('stops waiting when aborted', async () => {
    vi.useFakeTimers();
    const send = vi.fn().mockResolvedValue(response(429, '30'));
    const controller = new AbortController();
    const result = postWithRetries('Provider', send, post, controller.signal);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));

    controller.abort(new Error('request canceled'));
    await expect(result).rejects.toThrow('request canceled');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('postWithRetries response bodies', () => {
  it('cancels an intermediate retryable response body before retrying', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const cancel = vi.fn(() => {
      events.push('cancel');
    });
    const intermediate = new Response(new ReadableStream({ cancel }), { status: 503 });
    const success = new Response('ok');
    const send = vi.fn(async () => {
      if (send.mock.calls.length === 1) return intermediate;
      events.push('retry');
      return success;
    });

    const pending = postWithRetries('Provider', send, post);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toBe(success);
    expect(send).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(events).toEqual(['cancel', 'retry']);
  });

  it('returns a successful response with its body available to the caller', async () => {
    const success = new Response('success body');
    const send = vi.fn(async () => success);

    const response = await postWithRetries('Provider', send, post);

    expect(response).toBe(success);
    expect(response.bodyUsed).toBe(false);
    await expect(response.text()).resolves.toBe('success body');
    expect(send).toHaveBeenCalledOnce();
  });

  it('reads the final retryable response body for the existing error detail', async () => {
    vi.useFakeTimers();
    const cancelIntermediate = vi.fn();
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelIntermediate }), { status: 503 }))
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelIntermediate }), { status: 503 }))
      .mockResolvedValueOnce(new Response('final error detail', { status: 503 }));

    const pending = expect(postWithRetries('Provider', send, post)).rejects.toThrow(
      'Provider embeddings failed with HTTP 503: final error detail'
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;

    expect(send).toHaveBeenCalledTimes(3);
    expect(cancelIntermediate).toHaveBeenCalledTimes(2);
  });
});
