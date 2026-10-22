import {
  AI_SDK_STREAM_HEADER,
  SSE_DONE,
  SSE_HEADERS,
  SSE_PING,
  aiSdkEncoder,
  encodeSSE,
  errorBody,
  fromAiSdkRequest,
  type WirePart,
} from '@chatcops/core';
import { toLegacyStream, type ChatFormat, type ChatHandler, type ChatStart } from './handler.js';
import type { OriginPolicy } from './security/origin-policy.js';

/**
 * The HTTP side of a chat request, shared by every adapter: which stream
 * format to answer in, real statuses for refusals in protocol v1, SSE
 * framing, keep-alive pings and the one `[DONE]` at the end. Adapters only
 * move the bytes.
 */

export const PROTOCOL_HEADER = 'x-chatcops-protocol';
/** Requests over this size get 413. Every field has a ceiling, so a real request is far smaller. */
export const MAX_BODY_BYTES = 256 * 1024;
/** A comment line after this long with nothing sent, so the widget's inactivity timer doesn't fire during a slow tool. */
export const PING_INTERVAL_MS = 10_000;

/** Lets browsers read these on cross-origin replies. */
const EXPOSE_HEADERS = { 'Access-Control-Expose-Headers': 'Retry-After, X-ChatCops-Protocol' };

/**
 * Protocol v1 when the body has `protocol: 1` (what the widget sends) or the
 * `x-chatcops-protocol` header asks for it. Anything else gets the 0.5 format.
 */
export function wantsProtocolV1(body: unknown, header: string | null | undefined): boolean {
  if (header != null && Number(header) >= 1) return true;
  const protocol = body !== null && typeof body === 'object' ? (body as { protocol?: unknown }).protocol : undefined;
  return typeof protocol === 'number' && protocol >= 1;
}

export interface ChatReplyOptions {
  signal: AbortSignal;
  /** The `x-chatcops-protocol` request header. */
  protocolHeader?: string | null;
  pingIntervalMs?: number;
  /** Answer in the AI SDK's UI message stream instead of choosing by the request. */
  aiSdk?: boolean;
  /** The `Authorization` request header, for session tokens. */
  authorization?: string | null;
  /** The `Origin` request header. */
  origin?: string | null;
}

export type ChatReply =
  | { kind: 'json'; status: number; headers: Record<string, string>; body: unknown }
  | { kind: 'stream'; headers: Record<string, string>; frames: AsyncGenerator<string, void> };

/** What to send back for a parsed request body. */
export async function chatReply(
  handler: Pick<ChatHandler, 'startChat'>,
  body: unknown,
  clientIp: string | undefined,
  options: ChatReplyOptions
): Promise<ChatReply> {
  const format: ChatFormat = options.aiSdk ? 'ai-sdk' : wantsProtocolV1(body, options.protocolHeader) ? 'v1' : 'legacy';
  // Both typed formats refuse with a status; only 0.5 clients need a 200 stream.
  const typed = format !== 'legacy';
  const { signal } = options;
  const pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;

  let start: ChatStart;
  try {
    start = await handler.startChat(body, clientIp, { signal, format, authorization: options.authorization, origin: options.origin });
  } catch (err) {
    if (!signal.aborted) console.error('[chatcops] Unhandled error while handling chat:', err);
    if (typed) return { kind: 'json', status: 500, headers: EXPOSE_HEADERS, body: errorBody('internal_error') };
    // What 0.5 servers send, with no [DONE] after it.
    return stream(format, only(LEGACY_INTERNAL_ERROR));
  }

  if (!start.ok) {
    if (typed) {
      const headers: Record<string, string> = { ...EXPOSE_HEADERS };
      if (start.error.retryAfterMs !== undefined) headers['Retry-After'] = String(Math.ceil(start.error.retryAfterMs / 1000));
      return { kind: 'json', status: start.status, headers, body: { error: start.error } };
    }
    // 0.5 widgets read refusals from a 200 stream.
    return stream(format, only(`data: ${JSON.stringify(start.legacy)}\n\n`, SSE_DONE));
  }

  const source =
    format === 'v1' ? encodeParts(start.parts) : format === 'ai-sdk' ? encodeAiSdk(start.parts) : encodeLegacy(start.parts);
  return stream(format, frames(source, format, signal, pingIntervalMs));
}

const FORMAT_HEADERS: Record<ChatFormat, Record<string, string>> = {
  v1: { [PROTOCOL_HEADER]: '1' },
  'ai-sdk': { [AI_SDK_STREAM_HEADER]: 'v1' },
  legacy: {},
};

function stream(format: ChatFormat, frames: AsyncGenerator<string, void>): ChatReply {
  return { kind: 'stream', headers: { ...SSE_HEADERS, ...EXPOSE_HEADERS, ...FORMAT_HEADERS[format] }, frames };
}

async function* encodeParts(parts: AsyncIterable<WirePart>): AsyncGenerator<string> {
  for await (const part of parts) yield encodeSSE(part);
}

async function* encodeAiSdk(parts: AsyncIterable<WirePart>): AsyncGenerator<string> {
  const encode = aiSdkEncoder();
  for await (const part of parts) {
    for (const chunk of encode(part)) yield encodeSSE(chunk);
  }
}

async function* encodeLegacy(parts: AsyncIterable<WirePart>): AsyncGenerator<string> {
  for await (const chunk of toLegacyStream(parts)) yield `data: ${chunk}\n\n`;
}

const LEGACY_INTERNAL_ERROR = `data: ${JSON.stringify({ error: 'internal_error' })}\n\n`;

async function* only(...frames: string[]): AsyncGenerator<string, void> {
  yield* frames;
}

/**
 * The frames to write, with pings while nothing else is sent, `[DONE]` once
 * at the end, and nothing at all once the visitor has gone.
 */
async function* frames(
  source: AsyncGenerator<string>,
  format: ChatFormat,
  signal: AbortSignal,
  pingIntervalMs: number
): AsyncGenerator<string, void> {
  try {
    for await (const frame of withPings(source, pingIntervalMs)) {
      if (signal.aborted) return;
      yield frame;
    }
    if (!signal.aborted) yield SSE_DONE;
  } catch (err) {
    if (signal.aborted) return;
    console.error('[chatcops] Unhandled error while handling chat:', err);
    if (format !== 'legacy') {
      const tail: WirePart[] = [
        { type: 'error', code: 'internal_error', retryable: true },
        { type: 'finish', reason: 'error' },
      ];
      const encode = format === 'ai-sdk' ? aiSdkEncoder() : (part: WirePart) => [part];
      for (const part of tail) for (const chunk of encode(part)) yield encodeSSE(chunk);
      yield SSE_DONE;
    } else {
      yield LEGACY_INTERNAL_ERROR;
    }
  }
}

const PING = Symbol('ping');

async function* withPings(source: AsyncGenerator<string>, intervalMs: number): AsyncGenerator<string> {
  if (!(intervalMs > 0 && Number.isFinite(intervalMs))) {
    yield* source;
    return;
  }
  // The next frame stays pending across pings, so none is lost.
  let pending = source.next();
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = new Promise<typeof PING>((resolve) => {
        timer = setTimeout(resolve, intervalMs, PING);
      });
      const result = await Promise.race([pending, tick]).finally(() => clearTimeout(timer));
      if (result === PING) {
        yield SSE_PING;
        continue;
      }
      if (result.done) return;
      yield result.value;
      pending = source.next();
    }
  } finally {
    // When the reader stops early, end the reply too; it takes effect once
    // the step in progress finishes.
    source.return(undefined).catch(() => {});
  }
}

type ReadBody = { ok: true; body: unknown } | { ok: false; reason: 'too_large' | 'invalid_json' };

/** Reads and parses a JSON body, stopping at `maxBytes`. */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<ReadBody> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) return { ok: false, reason: 'too_large' };

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: 'too_large' };
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}

export interface FetchChatOptions {
  /** Called only for chat requests, after the method and origin checks. */
  clientIp(request: Request): string | undefined;
  /** Workers' `ctx.waitUntil`, so lead webhooks finish after the visitor leaves. */
  waitUntil?(promise: Promise<unknown>): void;
  pingIntervalMs?: number;
  /** Read `useChat` requests and answer in the AI SDK's UI message stream. */
  aiSdk?: boolean;
}

/** Whether a request is for the session endpoint: the chat URL plus `/session`. */
export function isSessionPath(pathname: string): boolean {
  return /\/session\/?$/.test(pathname);
}

/** The whole request for Fetch API runtimes (Vercel, Cloudflare, Next.js, Bun, Deno). */
export async function fetchChatResponse(
  handler: Pick<ChatHandler, 'startChat' | 'startSession'>,
  origins: OriginPolicy,
  request: Request,
  options: FetchChatOptions
): Promise<Response> {
  const origin = request.headers.get('origin');
  const cors = origins.headers(origin);
  const protocolHeader = request.headers.get(PROTOCOL_HEADER);
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors, ...headers } });

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: origins.preflightHeaders(origin) });
  }
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!origins.allows(origin)) return json(403, { error: 'origin_not_allowed' });

  if (isSessionPath(new URL(request.url).pathname)) {
    if (!handler.startSession) return json(404, errorBody('invalid_request', { message: 'Session tokens are off. Set `sessionSecrets` to turn them on.' }));
    const read = await readJsonBody(request, 16 * 1024);
    if (!read.ok) return json(400, errorBody('invalid_request', { message: 'Invalid session request' }));
    const reply = await handler.startSession(read.body, origin);
    return json(reply.status, reply.body);
  }

  const clientIp = options.clientIp(request);
  const read = await readJsonBody(request);
  if (!read.ok) {
    if (read.reason === 'too_large') {
      return json(413, errorBody('payload_too_large', { message: `The request body is over ${MAX_BODY_BYTES} bytes.` }), EXPOSE_HEADERS);
    }
    return json(
      400,
      options.aiSdk || wantsProtocolV1(undefined, protocolHeader) ? errorBody('invalid_request', { message: 'Invalid JSON body' }) : { error: 'Invalid JSON body' }
    );
  }

  const abort = new AbortController();
  const reply = await chatReply(handler, options.aiSdk ? fromAiSdkRequest(read.body) : read.body, clientIp, {
    signal: abort.signal,
    protocolHeader,
    pingIntervalMs: options.pingIntervalMs,
    aiSdk: options.aiSdk,
    authorization: request.headers.get('authorization'),
    origin,
  });
  if (reply.kind === 'json') return json(reply.status, reply.body, reply.headers);
  return sseResponse(reply.frames, { ...reply.headers, ...cors }, abort, options.waitUntil);
}

function sseResponse(
  frames: AsyncGenerator<string, void>,
  headers: Record<string, string>,
  abort: AbortController,
  waitUntil: FetchChatOptions['waitUntil']
): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // When the visitor disconnects the runtime cancels the response, which
  // errors the writer right away; abort then, without waiting for the next write.
  writer.closed.catch(() => abort.abort());

  const pump = (async () => {
    try {
      for await (const frame of frames) {
        if (abort.signal.aborted) break;
        try {
          await writer.write(encoder.encode(frame));
        } catch {
          abort.abort();
          break;
        }
      }
    } finally {
      if (abort.signal.aborted) await writer.abort().catch(() => {});
      else await writer.close().catch(() => {});
    }
  })();
  waitUntil?.(pump);

  return new Response(readable, { headers });
}
