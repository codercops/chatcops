import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { SSE_HEADERS, type WirePart } from '@chatcops/core';
import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { createChatHandler } from '../src/handler.js';
import { MAX_BODY_BYTES, chatReply, wantsProtocolV1 } from '../src/http.js';
import { chatcopsVercelHandler } from '../src/adapters/vercel.js';
import { chatcopsCloudflareHandler } from '../src/adapters/cloudflare.js';
import { chatcopsMiddleware } from '../src/adapters/express.js';
import type { ChatCopsServerConfig } from '../src/config.js';

const URL_ = 'http://localhost/api/chat';
const ip = () => '203.0.113.7';

function config(overrides: Partial<ChatCopsServerConfig> = {}): ChatCopsServerConfig {
  return {
    allowAnonymous: true,
    provider: scriptedProvider([textStep('Hello there')]),
    systemPrompt: 'Test',
    clientIp: ip,
    budgets: false,
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** Splits an SSE body into frames, keeping comments and [DONE]. */
function framesOf(text: string): string[] {
  return text.split('\n\n').filter(Boolean);
}

function partsOf(text: string): WirePart[] {
  return framesOf(text)
    .filter((frame) => frame.startsWith('data: {'))
    .map((frame) => JSON.parse(frame.slice(6)) as WirePart);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the 0.5 format', () => {
  it('is what requests without `protocol` get, logged once and counted', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const chat = createChatHandler(config({ provider: scriptedProvider([textStep('Hi'), textStep('Hi again')]) }));
    const handler = chatcopsVercelHandler(config({ provider: scriptedProvider([textStep('Hi'), textStep('Hi again')]) }));

    const res = await handler(post({ conversationId: 'legacy-1', message: 'Hello' }));
    expect(res.headers.get('x-chatcops-protocol')).toBeNull();
    expect(await res.text()).toBe('data: {"content":"Hi"}\n\ndata: {"done":true}\n\ndata: [DONE]\n\n');
    await (await handler(post({ conversationId: 'legacy-2', message: 'Hello' }))).text();

    const legacyLogs = info.mock.calls.filter(([line]) => String(line).includes('0.5 stream format'));
    expect(legacyLogs).toHaveLength(1);

    for await (const _ of chat.handleChat({ conversationId: 'legacy-3', message: 'Hello' })) {
      // drain
    }
    expect(chat.protocolStats()).toEqual({ v1: 0, legacy: 1, 'ai-sdk': 0 });
  });

  it('still answers refusals inside a 200 stream', async () => {
    const handler = chatcopsVercelHandler(config());
    const res = await handler(post({ conversationId: 'legacy-bad' }));
    expect(res.status).toBe(200);
    const [first, last] = framesOf(await res.text());
    expect(JSON.parse(first.slice(6))).toMatchObject({ error: 'Invalid request', details: expect.any(Object) });
    expect(last).toBe('data: [DONE]');
  });
});

describe('protocol v1', () => {
  it('streams typed parts with the SSE headers and one [DONE]', async () => {
    const handler = chatcopsVercelHandler(config({ allowedOrigins: ['https://acme.com'] }));
    const res = await handler(post({ protocol: 1, conversationId: 'v1-a', message: 'Hello' }, { Origin: 'https://acme.com' }));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-chatcops-protocol')).toBe('1');
    for (const [name, value] of Object.entries(SSE_HEADERS)) expect(res.headers.get(name)).toBe(value);
    expect(res.headers.get('Connection')).toBeNull();
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://acme.com');
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('X-ChatCops-Protocol');

    const text = await res.text();
    const parts = partsOf(text);
    expect(parts[0]).toMatchObject({ type: 'start', protocol: 1, conversationId: 'v1-a', messageId: expect.any(String) });
    expect(parts.filter((p) => p.type === 'text-delta').map((p) => (p as { delta: string }).delta).join('')).toBe('Hello there');
    expect(parts.at(-1)).toEqual({ type: 'finish', reason: 'stop' });
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
    expect(text.match(/\[DONE\]/g)).toHaveLength(1);
  });

  it('is also chosen by the x-chatcops-protocol header', async () => {
    const handler = chatcopsVercelHandler(config());
    const res = await handler(post({ conversationId: 'v1-header', message: 'Hello' }, { 'x-chatcops-protocol': '1' }));
    expect(res.headers.get('x-chatcops-protocol')).toBe('1');
    expect(partsOf(await res.text())[0]).toMatchObject({ type: 'start' });
  });

  it('answers an invalid request with 400 and the field names only', async () => {
    const handler = chatcopsVercelHandler(config());
    const res = await handler(post({ protocol: 1, conversationId: 'v1-bad', message: '' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await res.json()).toEqual({ error: { code: 'invalid_request', message: 'Invalid request: message' } });
  });

  it('answers a bad JSON body with the v1 error shape when the header asks for v1', async () => {
    const handler = chatcopsVercelHandler(config());
    const res = await handler(post('{nope', { 'x-chatcops-protocol': '1' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: 'invalid_request', message: 'Invalid JSON body' } });
  });

  it('answers a rate limited request with 429, Retry-After and retryAfterMs', async () => {
    const handler = chatcopsVercelHandler(
      config({
        provider: scriptedProvider([textStep('One')]),
        rateLimit: { maxRequests: 1, windowMs: 60_000 },
      })
    );
    await (await handler(post({ protocol: 1, conversationId: 'v1-rl-1', message: 'Hi' }))).text();
    const res = await handler(post({ protocol: 1, conversationId: 'v1-rl-2', message: 'Hi' }));

    expect(res.status).toBe(429);
    const retryAfter = Number(res.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = await res.json();
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterMs).toBeGreaterThan(0);
  });

  it('answers 503 provider_unavailable when the provider failed to start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = chatcopsVercelHandler(
      config({ provider: { type: 'no-such-provider' } as unknown as ChatCopsServerConfig['provider'] })
    );
    const res = await handler(post({ protocol: 1, conversationId: 'v1-503', message: 'Hi' }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: 'provider_unavailable' } });
  });

  it('answers 409 conversation_busy while another reply is being written', async () => {
    const handler = chatcopsVercelHandler(config({ provider: scriptedProvider(['hang', textStep('Later')]) }));
    const first = await handler(post({ protocol: 1, conversationId: 'v1-busy', message: 'One' }));
    const reader = first.body?.getReader();
    if (!reader) throw new Error('expected a body');
    await reader.read();

    const second = await handler(post({ protocol: 1, conversationId: 'v1-busy', message: 'Two' }));
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: { code: 'conversation_busy' } });

    await reader.cancel();
  });

  it('answers 413 for a body over the cap, declared or not', async () => {
    const handler = chatcopsVercelHandler(config());
    const big = JSON.stringify({ protocol: 1, conversationId: 'v1-big', message: 'x'.repeat(MAX_BODY_BYTES) });

    const declared = await handler(post(big));
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({ error: { code: 'payload_too_large' } });

    const bytes = new TextEncoder().encode(big);
    const chunked = new Request(URL_, {
      method: 'POST',
      body: new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 16_384) controller.enqueue(bytes.slice(i, i + 16_384));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    expect(chunked.headers.get('content-length')).toBeNull();
    const res = await handler(chunked);
    expect(res.status).toBe(413);
  });

  it('streams a provider error as an error part and finish, then [DONE]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = chatcopsVercelHandler(config({ provider: scriptedProvider([new Error('upstream 500')]) }));
    const res = await handler(post({ protocol: 1, conversationId: 'v1-err', message: 'Hi' }));
    expect(res.status).toBe(200);
    const text = await res.text();
    const parts = partsOf(text);
    expect(parts.find((p) => p.type === 'error')).toMatchObject({ code: 'provider_error' });
    expect(parts.at(-1)).toEqual({ type: 'finish', reason: 'error' });
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
  });

  it('replays a saved answer to a retried message without calling the model', async () => {
    const provider = scriptedProvider([textStep('Saved answer')]);
    const handler = chatcopsVercelHandler(config({ provider }));
    const body = { protocol: 1, conversationId: 'v1-retry', message: 'Hi', messageId: 'u1' };

    const first = partsOf(await (await handler(post(body))).text());
    const again = partsOf(await (await handler(post(body))).text());

    expect(provider.calls).toHaveLength(1);
    const firstStart = first[0] as Extract<WirePart, { type: 'start' }>;
    expect(again).toEqual([
      { type: 'start', protocol: 1, conversationId: 'v1-retry', messageId: firstStart.messageId },
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', delta: 'Saved answer' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', reason: 'stop' },
    ]);
  });

  it('adds usage to finish only with exposeUsage', async () => {
    const off = partsOf(await (await chatcopsVercelHandler(config())(post({ protocol: 1, conversationId: 'u-off', message: 'Hi' }))).text());
    expect(off.at(-1)).not.toHaveProperty('usage');

    const handler = chatcopsVercelHandler(config({ exposeUsage: true }));
    const on = partsOf(await (await handler(post({ protocol: 1, conversationId: 'u-on', message: 'Hi' }))).text());
    expect(on.at(-1)).toEqual({ type: 'finish', reason: 'stop', usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it('allows the protocol and Authorization headers in the preflight', async () => {
    const res = await chatcopsVercelHandler(config())(new Request(URL_, { method: 'OPTIONS' }));
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, X-ChatCops-Protocol');
  });
});

describe('chatReply', () => {
  it('pings while the model is slow and loses no part', async () => {
    const chat = createChatHandler(config({ provider: scriptedProvider([textStep('Slow reply', { chunkSize: 5 })], { delayMs: 60 }) }));
    const reply = await chatReply(chat, { protocol: 1, conversationId: 'ping', message: 'Hi' }, undefined, {
      signal: new AbortController().signal,
      pingIntervalMs: 20,
    });
    expect(reply.kind).toBe('stream');
    if (reply.kind !== 'stream') return;

    const frames: string[] = [];
    for await (const frame of reply.frames) frames.push(frame);
    expect(frames).toContain(': ping\n\n');
    const text = frames.join('');
    expect(partsOf(text).filter((p) => p.type === 'text-delta').map((p) => (p as { delta: string }).delta).join('')).toBe('Slow reply');
    expect(frames.at(-1)).toBe('data: [DONE]\n\n');
  });

  it('ends a v1 stream that throws with internal_error, finish and [DONE]', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('boom');
    const handler = {
      startChat: async () => ({
        ok: true as const,
        parts: (async function* (): AsyncGenerator<WirePart, void> {
          yield { type: 'start', protocol: 1, conversationId: 'c', messageId: 'm' };
          throw failure;
        })(),
      }),
    };
    const reply = await chatReply(handler, { protocol: 1 }, undefined, { signal: new AbortController().signal });
    if (reply.kind !== 'stream') throw new Error('expected a stream');
    const frames: string[] = [];
    for await (const frame of reply.frames) frames.push(frame);

    expect(frames.slice(1)).toEqual([
      'data: {"type":"error","code":"internal_error","retryable":true}\n\n',
      'data: {"type":"finish","reason":"error"}\n\n',
      'data: [DONE]\n\n',
    ]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('[chatcops]'), failure);
  });

  it('answers 500 JSON in v1 when the handler throws before streaming', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = {
      startChat: async () => {
        throw new Error('boom');
      },
    };
    const reply = await chatReply(handler, { protocol: 1 }, undefined, { signal: new AbortController().signal });
    expect(reply).toMatchObject({ kind: 'json', status: 500, body: { error: { code: 'internal_error' } } });
  });
});

describe('wantsProtocolV1', () => {
  it('reads the body field or the header', () => {
    expect(wantsProtocolV1({ protocol: 1 }, null)).toBe(true);
    expect(wantsProtocolV1({ protocol: 2 }, null)).toBe(true);
    expect(wantsProtocolV1({}, '1')).toBe(true);
    expect(wantsProtocolV1({ protocol: '1' }, null)).toBe(false);
    expect(wantsProtocolV1('text', null)).toBe(false);
    expect(wantsProtocolV1(null, undefined)).toBe(false);
    expect(wantsProtocolV1({}, 'abc')).toBe(false);
  });
});

describe('every adapter speaks v1', () => {
  it('Cloudflare', async () => {
    const handler = chatcopsCloudflareHandler(config());
    const waitUntil = vi.fn();
    const res = await handler(post({ protocol: 1, conversationId: 'cf', message: 'Hi' }), {}, { waitUntil });
    expect(res.headers.get('x-chatcops-protocol')).toBe('1');
    const text = await res.text();
    expect(partsOf(text).at(-1)).toEqual({ type: 'finish', reason: 'stop' });
    expect(text.endsWith('data: [DONE]\n\n')).toBe(true);
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it('Express, including a JSON refusal', async () => {
    const run = async (body: unknown) => {
      const chunks: string[] = [];
      const headers: Record<string, string> = {};
      const res = {
        writableFinished: false,
        statusCode: 200,
        jsonBody: undefined as unknown,
        setHeader: (name: string, value: string) => {
          headers[name] = value;
        },
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(value: unknown) {
          this.jsonBody = value;
        },
        write: (chunk: string) => {
          chunks.push(chunk);
          return true;
        },
        end: vi.fn(),
        on: vi.fn(),
      };
      const req = { method: 'POST', body, ip: '127.0.0.1', socket: {}, headers: {} };
      await chatcopsMiddleware(sharedExpressConfig)(
        req as unknown as ExpressRequest,
        res as unknown as ExpressResponse,
        vi.fn() as unknown as NextFunction
      );
      return { chunks, headers, res };
    };

    const ok = await run({ protocol: 1, conversationId: 'ex', message: 'Hi' });
    expect(ok.headers['x-chatcops-protocol']).toBe('1');
    expect(partsOf(ok.chunks.join('')).at(-1)).toEqual({ type: 'finish', reason: 'stop' });
    expect(ok.chunks.at(-1)).toBe('data: [DONE]\n\n');

    const bad = await run({ protocol: 1, conversationId: 'ex-bad' });
    expect(bad.res.statusCode).toBe(400);
    expect(bad.res.jsonBody).toEqual({ error: { code: 'invalid_request', message: 'Invalid request: message' } });
    expect(bad.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(bad.chunks).toEqual([]);
  });
});

const sharedExpressConfig = config();
