import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

vi.mock('../../src/handler.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/handler.js')>();
  return {
    ...actual,
    createChatHandler: vi.fn(actual.createChatHandler),
  };
});

import { createChatHandler } from '../../src/handler.js';
vi.mock('@chatcops/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatcops/core')>();
  return {
    ...actual,
    createProvider: vi.fn().mockResolvedValue({
      name: 'test-provider',
      async *chat() {
        yield 'Hello';
      },
    }),
  };
});

import { chatcopsAnalyticsHandler, chatcopsMiddleware } from '../../src/adapters/express.js';
import type { ChatCopsServerConfig } from '../../src/config.js';

function createRequest(method: string, body?: unknown, headers?: Record<string, string>): Request {
  const normalizedHeaders: Record<string, string> = {};
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }
  }
  return {
    method,
    body,
    headers: normalizedHeaders,
    header: (name: string) => normalizedHeaders[name.toLowerCase()],
    get: (name: string) => normalizedHeaders[name.toLowerCase()],
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
}

type FakeResponse = {
  statusCode: number;
  headers: Record<string, unknown>;
  chunks: string[];
  body: unknown;
  ended: boolean;
  setHeader: (name: string, value: unknown) => void;
  status: (code: number) => FakeResponse;
  json: (payload: unknown) => FakeResponse;
  write: (chunk: string) => boolean;
  end: () => FakeResponse;
  writableFinished: boolean;
  on: (event: string, listener: () => void) => FakeResponse;
  /** Simulates the visitor disconnecting before the reply is done. */
  disconnect: () => void;
};

function createResponse(): { fake: FakeResponse; res: Response } {
  const fake: FakeResponse = {
    statusCode: 200,
    headers: {},
    chunks: [],
    body: undefined,
    ended: false,
    setHeader: (name, value) => {
      fake.headers[name] = value;
    },
    status: (code) => {
      fake.statusCode = code;
      return fake;
    },
    json: (payload) => {
      fake.body = payload;
      return fake;
    },
    write: (chunk) => {
      fake.chunks.push(chunk);
      return true;
    },
    end: () => {
      fake.ended = true;
      fake.writableFinished = true;
      return fake;
    },
    writableFinished: false,
    on: (event, listener) => {
      listeners[event] ??= [];
      listeners[event].push(listener);
      return fake;
    },
    disconnect: () => {
      for (const listener of listeners.close ?? []) listener();
    },
  };
  const listeners: Record<string, Array<() => void>> = {};
  return { fake, res: fake as unknown as Response };
}

describe('express analytics sharing', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
  });

  afterEach(() => {
    for (const result of setIntervalSpy.mock.results) {
      clearInterval(result.value as ReturnType<typeof setInterval>);
    }
    vi.restoreAllMocks();
  });

  it('writes an internal_error event and ends when the handler throws', async () => {
    vi.mocked(createChatHandler).mockImplementationOnce(() => ({
      startChat: async () => {
        throw new Error('Unexpected handler failure');
      },
      getAnalytics: () => null,
      cleanup: () => undefined,
    }));

    const config: ChatCopsServerConfig = {
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      allowedOrigins: ['*'],
    };
    const middleware = chatcopsMiddleware(config);
    const { fake, res } = createResponse();

    await middleware(
      createRequest('POST', {
        conversationId: 'express-error-test',
        message: 'Hello',
      }),
      res,
      (() => undefined) as NextFunction,
    );

    expect(fake.chunks).toContain(
      `data: ${JSON.stringify({ error: 'internal_error' })}\n\n`,
    );
    expect(fake.chunks).not.toContain('data: [DONE]\n\n');
    expect(fake.ended).toBe(true);
  });

  it('logs the error before writing internal_error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('Unexpected handler failure');
    vi.mocked(createChatHandler).mockImplementationOnce(() => ({
      startChat: async () => {
        throw failure;
      },
      getAnalytics: () => null,
      cleanup: () => undefined,
    }));

    const middleware = chatcopsMiddleware({
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
    });
    const { fake, res } = createResponse();

    await middleware(
      createRequest('POST', { conversationId: 'express-log-test', message: 'secret message' }),
      res,
      (() => undefined) as NextFunction,
    );

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[chatcops]'), failure);
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret message');
    expect(fake.chunks).toEqual([`data: ${JSON.stringify({ error: 'internal_error' })}\n\n`]);
  });

  it('does not log an error that follows a visitor disconnect', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fake, res } = createResponse();
    vi.mocked(createChatHandler).mockImplementationOnce(() => ({
      startChat: async () => ({
        ok: true as const,
        parts: (async function* () {
          yield { type: 'text-delta' as const, id: 't1', delta: 'Hi' };
          fake.disconnect();
          throw new DOMException('Aborted', 'AbortError');
        })(),
      }),
      getAnalytics: () => null,
      cleanup: () => undefined,
    }));

    const middleware = chatcopsMiddleware({
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
    });

    await middleware(
      createRequest('POST', { conversationId: 'express-disconnect-log-test', message: 'Hello' }),
      res,
      (() => undefined) as NextFunction,
    );

    expect(errorSpy).not.toHaveBeenCalled();
    expect(fake.chunks.join('')).not.toContain('internal_error');
  });

  it('returns 204 with CORS headers for OPTIONS requests', async () => {
    const config: ChatCopsServerConfig = {
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      allowedOrigins: ['*'],
    };
    const middleware = chatcopsMiddleware(config);
    const { fake, res } = createResponse();

    await middleware(
      createRequest('OPTIONS'),
      res,
      (() => undefined) as NextFunction,
    );

    expect(fake.statusCode).toBe(204);
    expect(fake.headers).toMatchObject({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-ChatCops-Protocol',
      'Access-Control-Max-Age': '86400',
    });
    expect(fake.ended).toBe(true);
    expect(fake.body).toBeUndefined();
  });

  it('returns 405 JSON for GET requests', async () => {
    const config: ChatCopsServerConfig = {
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      allowedOrigins: ['*'],
    };
    const middleware = chatcopsMiddleware(config);
    const { fake, res } = createResponse();

    await middleware(
      createRequest('GET'),
      res,
      (() => undefined) as NextFunction,
    );

    expect(fake.statusCode).toBe(405);
    expect(fake.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(fake.headers.Allow).toBe('POST, OPTIONS');
    expect(fake.body).toEqual({ error: 'Method not allowed' });
    expect(fake.chunks).toEqual([]);
    expect(fake.ended).toBe(false);
  });

  it('returns Access-Control-Allow-Origin: * for 405 when cors is not configured', async () => {
    const config: ChatCopsServerConfig = {
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
    };
    const middleware = chatcopsMiddleware(config);
    const { fake, res } = createResponse();

    await middleware(
      createRequest('GET'),
      res,
      (() => undefined) as NextFunction,
    );

    expect(fake.statusCode).toBe(405);
    expect(fake.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(fake.body).toEqual({ error: 'Method not allowed' });
    expect(fake.chunks).toEqual([]);
    expect(fake.ended).toBe(false);
  });

  it('returns custom Access-Control-Allow-Origin for 405 when cors is configured', async () => {
    const config: ChatCopsServerConfig = {
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      allowedOrigins: ['https://example.com'],
    };
    const middleware = chatcopsMiddleware(config);
    const { fake, res } = createResponse();

    await middleware(
      createRequest('GET', undefined, { Origin: 'https://example.com' }),
      res,
      (() => undefined) as NextFunction,
    );

    expect(fake.statusCode).toBe(405);
    expect(fake.headers['Access-Control-Allow-Origin']).toBe('https://example.com');
    expect(fake.body).toEqual({ error: 'Method not allowed' });
    expect(fake.chunks).toEqual([]);
    expect(fake.ended).toBe(false);
  });

  it('streams chunks as SSE data, writes DONE, and ends the response', async () => {
    const config: ChatCopsServerConfig = {
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      allowedOrigins: ['*'],
    };
    const middleware = chatcopsMiddleware(config);
    const { fake, res } = createResponse();

    await middleware(
      createRequest('POST', {
        conversationId: 'express-sse-test',
        message: 'Hello',
      }),
      res,
      (() => undefined) as NextFunction,
    );

    expect(fake.headers).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    expect(fake.headers).not.toHaveProperty('Connection');
    expect(fake.chunks).toContain('data: {"content":"Hello"}\n\n');
    expect(fake.chunks.at(-1)).toBe('data: [DONE]\n\n');
    expect(fake.ended).toBe(true);
  });

  it('reports middleware traffic through chatcopsAnalyticsHandler', async () => {
    const config: ChatCopsServerConfig = {
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      allowedOrigins: ['*'],
      analytics: true,
    };
    vi.mocked(createChatHandler).mockClear();

    const middleware = chatcopsMiddleware(config);

    for (const conversationId of ['conv-1', 'conv-2']) {
      const { fake, res } = createResponse();
      await middleware(
        createRequest('POST', { conversationId, message: 'Hello' }),
        res,
        (() => undefined) as NextFunction
      );
      expect(fake.chunks.join('')).toContain('data: [DONE]');
      expect(fake.ended).toBe(true);
    }

    const { fake: statsFake, res: statsRes } = createResponse();
    await chatcopsAnalyticsHandler(config)(createRequest('GET'), statsRes);

    expect(statsFake.body).toMatchObject({ totalConversations: 2 });
    // One handler for the config, shared by the middleware and the stats route.
    expect(createChatHandler).toHaveBeenCalledTimes(1);
  });

  it('warns once across several requests when analyticsToken is not configured', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config: ChatCopsServerConfig = {
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      analytics: true,
    };
    const handler = chatcopsAnalyticsHandler(config);

    const { fake: firstFake, res: firstRes } = createResponse();
    await handler(createRequest('GET'), firstRes);
    expect(firstFake.statusCode).toBe(200);

    const { fake: secondFake, res: secondRes } = createResponse();
    await handler(createRequest('GET'), secondRes);
    expect(secondFake.statusCode).toBe(200);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('analyticsToken')
    );
  });

  it('requires a bearer token when analyticsToken is configured', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const config: ChatCopsServerConfig = {
      allowAnonymous: true,
      provider: { type: 'claude', apiKey: 'test-key' },
      systemPrompt: 'Test',
      analytics: true,
      analyticsToken: 'secret-token',
    };
    const handler = chatcopsAnalyticsHandler(config);

    // Missing token
    const { fake: missingFake, res: missingRes } = createResponse();
    await handler(createRequest('GET'), missingRes);
    expect(missingFake.statusCode).toBe(401);
    expect(missingFake.headers['WWW-Authenticate']).toBe('Bearer');
    expect(missingFake.body).toEqual({ error: 'unauthorized' });

    // Wrong token of different length
    const { fake: diffLengthFake, res: diffLengthRes } = createResponse();
    await handler(createRequest('GET', undefined, { authorization: 'Bearer short' }), diffLengthRes);
    expect(diffLengthFake.statusCode).toBe(401);
    expect(diffLengthFake.headers['WWW-Authenticate']).toBe('Bearer');
    expect(diffLengthFake.body).toEqual({ error: 'unauthorized' });

    // Wrong token of same length
    const { fake: wrongFake, res: wrongRes } = createResponse();
    await handler(createRequest('GET', undefined, { authorization: 'Bearer secret-tokeX' }), wrongRes);
    expect(wrongFake.statusCode).toBe(401);
    expect(wrongFake.headers['WWW-Authenticate']).toBe('Bearer');
    expect(wrongFake.body).toEqual({ error: 'unauthorized' });

    // Right token
    const { fake: rightFake, res: rightRes } = createResponse();
    await handler(createRequest('GET', undefined, { authorization: 'Bearer secret-token' }), rightRes);
    expect(rightFake.statusCode).toBe(200);
    expect(rightFake.body).toMatchObject({ totalConversations: 0 });

    expect(warnSpy).not.toHaveBeenCalled();
  });
});
