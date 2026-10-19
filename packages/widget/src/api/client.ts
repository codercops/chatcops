import type { WidgetChatRequest, WidgetChatChunk } from './types.js';

export interface ChatClientOptions {
  apiUrl: string;
  /** Inactivity timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
}

export interface SendMessageOptions {
  signal?: AbortSignal;
  /** Override the client's inactivity timeout for this request, in milliseconds. */
  timeout?: number;
}

export class ChatClient {
  private apiUrl: string;
  private timeout: number;

  constructor(options: ChatClientOptions) {
    this.apiUrl = options.apiUrl;
    this.timeout = options.timeout ?? 30000;
  }

  async *sendMessage(
    request: WidgetChatRequest,
    options: SendMessageOptions = {}
  ): AsyncGenerator<WidgetChatChunk> {
    const controller = new AbortController();
    const timeout = options.timeout ?? this.timeout;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const externalSignal = options.signal;
    const onExternalAbort = () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
    const resetTimeout = () => {
      clearTimeout(timeoutId);
      if (controller.signal.aborted) return;
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeout);
    };
    const cleanup = async () => {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', onExternalAbort);
      if (reader) {
        const currentReader = reader;
        reader = undefined;
        try {
          await currentReader.cancel();
        } catch {
          // The stream may already have failed or been aborted.
        } finally {
          currentReader.releaseLock();
        }
      }
    };

    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort);
      }
    }
    resetTimeout();

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        await cleanup();
        if (response.status === 429) {
          yield { error: 'rate_limit' };
          return;
        }
        yield { error: `HTTP ${response.status}` };
        return;
      }

      reader = response.body?.getReader();
      if (!reader) {
        await cleanup();
        yield { error: 'No response body' };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Transport activity counts even before a complete, valid SSE event arrives.
        if (value.byteLength > 0) resetTimeout();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            await cleanup();
            yield { done: true };
            return;
          }

          try {
            yield JSON.parse(data) as WidgetChatChunk;
          } catch {
            // Skip malformed chunks
          }
        }
      }

      await cleanup();
      yield { done: true };
    } catch (err) {
      await cleanup();
      if (err instanceof DOMException && err.name === 'AbortError') {
        yield timedOut ? { error: 'timeout' } : { error: 'aborted' };
      } else {
        yield { error: 'network' };
      }
    } finally {
      await cleanup();
    }
  }
}
