import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

export interface ReplayOptions {
  /**
   * Send only this many bytes of each response, then wait until the request
   * is aborted. For testing cancellation partway through a stream.
   */
  hangAfterBytes?: number;
}

export interface Replay {
  /** Pass as `fetch` in the provider config. */
  fetch: typeof fetch;
  /** The JSON body of each request the provider sent, in order. */
  requests: Record<string, unknown>[];
  /** The request bodies the fixture was recorded with, in order. */
  recordedRequests: Record<string, unknown>[];
}

/**
 * A `fetch` that answers each request with the next recorded response body
 * from `tests/fixtures/<provider>/<name>/`. The SDK's own stream parser reads
 * it, so a test covers the same code path as a live request.
 */
export function replayFetch(provider: string, name: string, options: ReplayOptions = {}): Replay {
  const dir = join(FIXTURES, provider, name);
  const files = readdirSync(dir).sort();
  const responses = files.filter((file) => file.endsWith('.response.sse'));
  const recordedRequests = files
    .filter((file) => file.endsWith('.request.json'))
    .map((file) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, unknown>);
  const requests: Record<string, unknown>[] = [];

  const replay: typeof fetch = async (_input, init) => {
    const file = responses[requests.length];
    if (!file) throw new Error(`No recorded response ${requests.length + 1} in fixtures/${provider}/${name}.`);
    requests.push(typeof init?.body === 'string' ? JSON.parse(init.body) : {});

    const body = readFileSync(join(dir, file));
    const signal = init?.signal ?? undefined;
    const limit = options.hangAfterBytes;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (limit === undefined) {
          controller.enqueue(new Uint8Array(body));
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(body.subarray(0, limit)));
        const abort = () => controller.error(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      },
    });

    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };

  return { fetch: replay, requests, recordedRequests };
}
