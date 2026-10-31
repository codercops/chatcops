import { afterEach, describe, expect, it, vi } from 'vitest';
import { postWithRetries } from '../../src/retrieval/http.js';

const post = { url: 'https://api.test/embeddings', headers: {}, body: {} };

afterEach(() => {
  vi.useRealTimers();
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
