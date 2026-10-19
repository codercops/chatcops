import { vi } from 'vitest';

/** A fetch/stream fixture that actually rejects when the client's signal aborts. */
export function mockChatStream(respondImmediately = true) {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let signal: AbortSignal;
  let body: ReadableStream<Uint8Array>;
  let rejectResponse: (error: Error) => void;
  let pendingResponse = true;

  const stop = () => signal.removeEventListener('abort', onAbort);
  const onAbort = () => {
    const error = new DOMException('Aborted', 'AbortError');
    if (pendingResponse) rejectResponse(error);
    controller.error(error);
    stop();
  };
  const cancel = vi.fn(stop);
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_url, options) => {
    signal = options!.signal!;
    if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    body = new ReadableStream<Uint8Array>({
      start(streamController) { controller = streamController; },
      cancel,
    });
    signal.addEventListener('abort', onAbort);
    return new Promise<Response>((resolve, reject) => {
      rejectResponse = reject;
      if (respondImmediately) {
        pendingResponse = false;
        resolve(new Response(body));
      }
    });
  });

  return {
    get signal() { return signal; },
    get body() { return body; },
    cancel,
    send(data: string) { controller.enqueue(encoder.encode(data)); },
    close() { controller.close(); stop(); },
    fail() { controller.error(new Error('Connection lost')); stop(); },
  };
}
