import { afterEach, describe, expect, it, vi } from 'vitest';
import { type TurnstileConfig, verifyTurnstile } from '../../src/security/turnstile.js';

type CapturedCall = { url: string; init: RequestInit };

function createMockFetch(responses: Array<Response | Error>) {
  const calls: CapturedCall[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), init: init ?? {} });
    const next = responses.shift() ?? new Response(JSON.stringify({ success: true }), { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { calls, fetchFn };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyTurnstile', () => {
  const baseConfig: TurnstileConfig = {
    secretKey: '0x4AAAAAA-test-secret-key',
  };

  describe('successful verification', () => {
    it('returns ok: true on successful verification', async () => {
      const { calls, fetchFn } = createMockFetch([
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      ]);

      const result = await verifyTurnstile('valid-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({ ok: true });
      expect(calls).toHaveLength(1);
    });

    it('returns hostname and action when present in response', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: true,
            hostname: 'chat.example.com',
            action: 'login',
          }),
          { status: 200 }
        ),
      ]);

      const result = await verifyTurnstile('valid-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: true,
        hostname: 'chat.example.com',
        action: 'login',
      });
    });

    it('validates matching hostname case-insensitively when expectedHostnames is configured', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: true,
            hostname: 'chat.example.com',
          }),
          { status: 200 }
        ),
      ]);

      const config: TurnstileConfig = {
        ...baseConfig,
        expectedHostnames: ['CHAT.EXAMPLE.COM', 'app.example.com'],
      };

      const result = await verifyTurnstile('valid-token', config, { fetch: fetchFn });

      expect(result).toEqual({
        ok: true,
        hostname: 'chat.example.com',
      });
    });

    it('validates matching action when config.action is configured', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: true,
            action: 'submit-feedback',
          }),
          { status: 200 }
        ),
      ]);

      const config: TurnstileConfig = {
        ...baseConfig,
        action: 'submit-feedback',
      };

      const result = await verifyTurnstile('valid-token', config, { fetch: fetchFn });

      expect(result).toEqual({
        ok: true,
        action: 'submit-feedback',
      });
    });
  });

  describe('success: false and error codes', () => {
    it('maps success: false to invalid_token with preserved error-codes', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: false,
            'error-codes': ['invalid-input-response'],
          }),
          { status: 200 }
        ),
      ]);

      const result = await verifyTurnstile('bad-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'invalid_token',
        errorCodes: ['invalid-input-response'],
      });
    });

    it('maps multiple error-codes correctly', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: false,
            'error-codes': ['invalid-input-response', 'timeout-or-duplicate'],
          }),
          { status: 200 }
        ),
      ]);

      const result = await verifyTurnstile('bad-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'invalid_token',
        errorCodes: ['invalid-input-response', 'timeout-or-duplicate'],
      });
    });

    it('maps success: false without error-codes', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: false,
          }),
          { status: 200 }
        ),
      ]);

      const result = await verifyTurnstile('bad-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'invalid_token',
      });
      expect('errorCodes' in result).toBe(false);
    });

    it('maps 400 response with success: false and error-codes to invalid_token', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: false,
            'error-codes': ['invalid-input-response'],
          }),
          { status: 400 }
        ),
      ]);

      const result = await verifyTurnstile('bad-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'invalid_token',
        errorCodes: ['invalid-input-response'],
      });
    });

    it('returns unavailable with errorCodes when error-codes includes internal-error', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: false,
            'error-codes': ['internal-error'],
          }),
          { status: 200 }
        ),
      ]);

      const result = await verifyTurnstile('bad-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'unavailable',
        errorCodes: ['internal-error'],
      });
    });
  });

  describe('hostname and action mismatch', () => {
    it('returns hostname_mismatch when returned hostname does not match expectedHostnames', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: true,
            hostname: 'evil.com',
          }),
          { status: 200 }
        ),
      ]);

      const config: TurnstileConfig = {
        ...baseConfig,
        expectedHostnames: ['chat.example.com'],
      };

      const result = await verifyTurnstile('valid-token', config, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'hostname_mismatch',
      });
    });

    it('returns hostname_mismatch when expectedHostnames is set but hostname is omitted in response', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: true,
          }),
          { status: 200 }
        ),
      ]);

      const config: TurnstileConfig = {
        ...baseConfig,
        expectedHostnames: ['chat.example.com'],
      };

      const result = await verifyTurnstile('valid-token', config, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'hostname_mismatch',
      });
    });

    it('returns action_mismatch when returned action does not match config.action', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: true,
            action: 'unexpected-action',
          }),
          { status: 200 }
        ),
      ]);

      const config: TurnstileConfig = {
        ...baseConfig,
        action: 'login',
      };

      const result = await verifyTurnstile('valid-token', config, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'action_mismatch',
      });
    });

    it('returns action_mismatch when config.action is set but action is omitted in response', async () => {
      const { fetchFn } = createMockFetch([
        new Response(
          JSON.stringify({
            success: true,
          }),
          { status: 200 }
        ),
      ]);

      const config: TurnstileConfig = {
        ...baseConfig,
        action: 'login',
      };

      const result = await verifyTurnstile('valid-token', config, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'action_mismatch',
      });
    });
  });

  describe('empty or absent token', () => {
    it.each([undefined, '', '   ', '\t\n'])(
      'returns missing_token without calling fetch for %j',
      async (token) => {
        const { calls, fetchFn } = createMockFetch([]);

        const result = await verifyTurnstile(token, baseConfig, { fetch: fetchFn });

        expect(result).toEqual({
          ok: false,
          code: 'missing_token',
        });
        expect(calls).toHaveLength(0);
      }
    );
  });

  describe('network failure, timeout, and non-JSON response', () => {
    it('returns unavailable on network error without throwing', async () => {
      const { fetchFn } = createMockFetch([new TypeError('Failed to fetch')]);

      const result = await verifyTurnstile('valid-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'unavailable',
      });
    });

    it('returns unavailable on timeout without throwing', async () => {
      const { fetchFn } = createMockFetch([
        new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      ]);

      const result = await verifyTurnstile('valid-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'unavailable',
      });
    });

    it('returns unavailable when fake fetch remains pending until init.signal aborts', async () => {
      let signalAborted = false;
      let signalReceived = false;

      const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('no signal passed to fetch'));
            return;
          }
          signalReceived = true;
          signal.addEventListener('abort', () => {
            signalAborted = true;
            reject(signal.reason ?? new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
          });
        });
      }) as typeof fetch;

      const config: TurnstileConfig = {
        ...baseConfig,
        timeoutMs: 20,
      };

      const result = await verifyTurnstile('valid-token', config, { fetch: fetchFn });

      expect(signalReceived).toBe(true);
      expect(signalAborted).toBe(true);
      expect(result).toEqual({
        ok: false,
        code: 'unavailable',
      });
    });

    it('returns unavailable on non-JSON response', async () => {
      const { fetchFn } = createMockFetch([
        new Response('<html>502 Bad Gateway</html>', { status: 502 }),
      ]);

      const result = await verifyTurnstile('valid-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'unavailable',
      });
    });

    it('returns unavailable on HTTP 500 response', async () => {
      const { fetchFn } = createMockFetch([
        new Response(JSON.stringify({ error: 'internal_error' }), { status: 500 }),
      ]);

      const result = await verifyTurnstile('valid-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'unavailable',
      });
    });

    it('returns unavailable on 400 response with success: true', async () => {
      const { fetchFn } = createMockFetch([
        new Response(JSON.stringify({ success: true }), { status: 400 }),
      ]);

      const result = await verifyTurnstile('valid-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'unavailable',
      });
    });

    it.each([
      ['empty object missing success boolean', {}],
      ['non-boolean success string', { success: 'true' }],
      ['null response', null],
      ['array response', []],
    ])('returns unavailable on unusable verification response (%s)', async (_, payload) => {
      const { fetchFn } = createMockFetch([
        new Response(JSON.stringify(payload), { status: 200 }),
      ]);

      const result = await verifyTurnstile('valid-token', baseConfig, { fetch: fetchFn });

      expect(result).toEqual({
        ok: false,
        code: 'unavailable',
      });
    });

    it('returns unavailable and never throws on unexpected internal errors', async () => {
      const config: TurnstileConfig = {
        ...baseConfig,
        timeoutMs: -1, // causes AbortSignal.timeout to throw RangeError
      };

      const result = await verifyTurnstile('valid-token', config);

      expect(result).toEqual({
        ok: false,
        code: 'unavailable',
      });
    });
  });

  describe('exact request URL, method, headers and body', () => {
    it('sends POST to Cloudflare siteverify endpoint with json headers and body', async () => {
      const { calls, fetchFn } = createMockFetch([
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      ]);

      await verifyTurnstile('token-123', baseConfig, { fetch: fetchFn });

      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call.url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect(call.init.method).toBe('POST');
      expect(call.init.headers).toEqual({
        'Content-Type': 'application/json',
      });
      expect(call.init.signal).toBeDefined();

      const parsedBody = JSON.parse(call.init.body as string);
      expect(parsedBody).toEqual({
        secret: '0x4AAAAAA-test-secret-key',
        response: 'token-123',
      });
    });

    it('includes remoteip and idempotency_key only when provided', async () => {
      const { calls, fetchFn } = createMockFetch([
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      ]);

      await verifyTurnstile('token-123', baseConfig, {
        remoteIp: '198.51.100.42',
        idempotencyKey: 'idemp-uuid-5678',
        fetch: fetchFn,
      });

      expect(calls).toHaveLength(1);
      const parsedBody = JSON.parse(calls[0].init.body as string);
      expect(parsedBody).toEqual({
        secret: '0x4AAAAAA-test-secret-key',
        response: 'token-123',
        remoteip: '198.51.100.42',
        idempotency_key: 'idemp-uuid-5678',
      });
    });

    it('respects custom timeoutMs when configured', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
      const { fetchFn } = createMockFetch([
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      ]);

      const config: TurnstileConfig = {
        ...baseConfig,
        timeoutMs: 3000,
      };

      await verifyTurnstile('token-timeout', config, { fetch: fetchFn });

      expect(timeoutSpy).toHaveBeenCalledWith(3000);
    });

    it('falls back to globalThis.fetch when opts.fetch is not supplied', async () => {
      const globalFetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 })
      );

      const result = await verifyTurnstile('token-global', baseConfig);

      expect(result).toEqual({ ok: true });
      expect(globalFetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = globalFetchSpy.mock.calls[0];
      expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect((init as RequestInit).method).toBe('POST');
    });
  });

  describe('secret protection and log cleanliness', () => {
    it('never leaks secret in return values or console output across scenarios', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const secret = 'ultra-confidential-secret-key-999';
      const config: TurnstileConfig = {
        secretKey: secret,
        action: 'test-action',
        expectedHostnames: ['expected.com'],
      };

      const testResponses = [
        new Response(JSON.stringify({ success: true, hostname: 'expected.com', action: 'test-action' }), { status: 200 }),
        new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 }),
        new Response(JSON.stringify({ success: true, hostname: 'wrong.com' }), { status: 200 }),
        new Response('Internal Server Error', { status: 500 }),
        new TypeError('Network down'),
      ];

      for (const response of testResponses) {
        const { fetchFn } = createMockFetch([response]);
        const result = await verifyTurnstile('test-token', config, { fetch: fetchFn });

        const serializedResult = JSON.stringify(result);
        expect(serializedResult).not.toContain(secret);
      }

      for (const spy of [logSpy, errorSpy, warnSpy]) {
        for (const call of spy.mock.calls) {
          const joined = call.map(String).join(' ');
          expect(joined).not.toContain(secret);
        }
      }
    });
  });
});
