import type { WirePart } from './protocol.js';
import { turnstileToken } from './turnstile.js';
import type { WidgetChatRequest, WidgetChatChunk } from './types.js';

export interface ChatClientOptions {
  apiUrl: string;
  /** Inactivity timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /** Cloudflare Turnstile site key, when the server checks Turnstile before issuing a session. */
  turnstileSiteKey?: string;
}

export interface SendMessageOptions {
  signal?: AbortSignal;
  /** Override the client's inactivity timeout for this request, in milliseconds. */
  timeout?: number;
}

/** A session token from `POST <apiUrl>/session`, for servers that have them on. */
interface Session {
  token: string;
  conversationId: string;
}

export class ChatClient {
  private apiUrl: string;
  private timeout: number;
  private sessionKey: string;
  /** The last token, kept across page loads so the server can resume the conversation. */
  private saved: Partial<Session> = {};
  private turnstileSiteKey?: string;

  constructor(options: ChatClientOptions) {
    this.apiUrl = options.apiUrl;
    this.turnstileSiteKey = options.turnstileSiteKey;
    this.timeout = options.timeout ?? 30000;
    this.sessionKey = `chatcops-session:${options.apiUrl}`;
    try {
      this.saved = JSON.parse(localStorage.getItem(this.sessionKey) || '{}');
    } catch {
      // Storage unavailable: tokens last for this page only.
    }
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
      const post = (url: string, body: object, token?: string) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      const saved = this.saved;
      const resumable = saved.conversationId === request.conversationId;
      // Servers before 0.6 ignore `protocol` and answer in the old format.
      let response = await post(this.apiUrl, { protocol: 1, ...request }, resumable ? saved.token : undefined);

      // Session tokens are on. Get a token for this conversation and try once
      // more. The previous token, even expired, lets the server resume the
      // conversation without Turnstile; without one it may give the
      // conversation a new id.
      if (response.status === 401) {
        const minted = await post(this.apiUrl.replace(/\/?(\?.*)?$/, '/session$1'), {
          conversationId: request.conversationId,
          previousToken: saved.token,
          turnstileToken: this.turnstileSiteKey && !resumable ? await turnstileToken(this.turnstileSiteKey) : undefined,
        });
        if (minted.ok) {
          const session = (await minted.json()) as Session;
          this.saved = session;
          try {
            localStorage.setItem(this.sessionKey, JSON.stringify(session));
          } catch {
            // Storage full or unavailable: the token still works on this page.
          }
          if (session.conversationId !== request.conversationId) {
            request = { ...request, conversationId: session.conversationId };
            yield { conversationId: session.conversationId };
          }
          response = await post(this.apiUrl, { protocol: 1, ...request }, session.token);
        } else {
          // A token the server won't resume from: start over, with Turnstile, on the next try.
          this.saved = {};
        }
      }

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
      // Protocol v1 parts have a `type`; 0.5 chunks never do. A v1 stream
      // ends with `finish`, so ending without one means it was cut off.
      let v1 = false;
      let finished = false;

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
            yield v1 && !finished ? { error: 'network' } : { done: true };
            return;
          }

          let chunk: WidgetChatChunk | WirePart;
          try {
            chunk = JSON.parse(data);
          } catch {
            continue; // Skip malformed chunks
          }
          if ('type' in chunk) {
            v1 = true;
            if (chunk.type === 'finish') finished = true;
            const mapped = fromPart(chunk);
            if (mapped) yield mapped;
          } else {
            yield chunk;
          }
        }
      }

      await cleanup();
      // A [DONE] with no newline after it still counts. Anything else means the
      // connection was cut mid-reply (a proxy timeout, a server crash), so the
      // visitor should see an error and a Retry button rather than half an answer.
      yield buffer.trim() === 'data: [DONE]' ? { done: true } : { error: 'network' };
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

/**
 * A protocol v1 part as the chunk the widget already handles, or null for
 * parts it doesn't use (and part types added later).
 */
function fromPart(part: WirePart): WidgetChatChunk | null {
  switch (part.type) {
    case 'start':
      return { messageId: part.messageId };
    case 'text-delta':
      return { content: part.delta };
    case 'lead-captured':
      return { leadCaptured: true, leadData: part.lead };
    case 'error':
      return { error: part.code === 'rate_limited' ? 'rate_limit' : part.code === 'timeout' ? 'timeout' : 'provider_error' };
    case 'finish':
      // An error part already went out, or nobody is listening.
      return part.reason === 'error' || part.reason === 'aborted' ? null : { done: true };
    default:
      return null;
  }
}
