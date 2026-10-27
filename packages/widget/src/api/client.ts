import type { WirePart } from './protocol.js';
import { keyStore, type KeyStore } from '../storage.js';
import type { WidgetChatRequest, WidgetChatChunk } from './types.js';

export interface ChatClientOptions {
  apiUrl: string;
  /** Inactivity timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /** Cloudflare Turnstile site key, when the server checks Turnstile before issuing a session. */
  turnstileSiteKey?: string;
  /** The host site's signed token for a signed-in visitor, sent when asking for a session. */
  userToken?: string;
  /** Where the session token is kept. Defaults to localStorage; the widget passes its own store. */
  store?: KeyStore;
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
  /** The last token, kept across page loads so the server can resume the conversation. Read on first use. */
  private saved?: Partial<Session>;
  private store: KeyStore;
  private turnstileSiteKey?: string;
  private userToken?: string;

  constructor(options: ChatClientOptions) {
    this.apiUrl = options.apiUrl;
    this.turnstileSiteKey = options.turnstileSiteKey;
    this.userToken = options.userToken;
    this.timeout = options.timeout ?? 30000;
    this.sessionKey = `chatcops-session:${options.apiUrl}`;
    this.store = options.store ?? keyStore('local');
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
      let saved = this.saved;
      if (!saved) {
        try {
          saved = (JSON.parse(this.store.get(this.sessionKey) || '{}') as Partial<Session> | null) ?? {};
        } catch {
          saved = {};
        }
        this.saved = saved;
      }
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
          userToken: this.userToken,
          // Its own chunk: only sites with a Turnstile key download it.
          turnstileToken:
            this.turnstileSiteKey && !resumable
              ? await (await import('./turnstile.js')).turnstileToken(this.turnstileSiteKey)
              : undefined,
        });
        if (minted.ok) {
          const session = (await minted.json()) as Session;
          this.saved = session;
          this.store.set(this.sessionKey, JSON.stringify(session));
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
        // Protocol v1 servers send `{ error: { code, retryAfterMs } }`.
        const { error } = await response.json().catch(() => ({}));
        await cleanup();
        yield error?.code
          ? errorChunk(error.code, error.retryAfterMs)
          : { error: response.status === 429 ? 'rate_limit' : `HTTP ${response.status}` };
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
            yield v1 && !finished ? { error: 'cut_off' } : { done: true };
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
      yield buffer.trim() === 'data: [DONE]' ? { done: true } : { error: v1 ? 'cut_off' : 'network' };
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

/** The widget's error type for a protocol v1 error code. */
const ERROR_TYPES: Record<string, string> = {
  rate_limited: 'rate_limit',
  timeout: 'timeout',
  budget_exceeded: 'budget',
  budget_daily: 'budget_daily',
  provider_unavailable: 'unavailable',
};

function errorChunk(code: string, retryAfterMs?: number): WidgetChatChunk {
  return { error: ERROR_TYPES[code] ?? 'provider_error', retryAfterMs };
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
      return errorChunk(part.code === 'budget_exceeded' && part.scope !== 'conversation' ? 'budget_daily' : part.code, part.retryAfterMs);
    case 'finish':
      // An error part already went out, or nobody is listening.
      return part.reason === 'error' || part.reason === 'aborted' ? null : { done: true };
    default:
      return null;
  }
}
