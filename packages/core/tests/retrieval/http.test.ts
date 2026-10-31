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
