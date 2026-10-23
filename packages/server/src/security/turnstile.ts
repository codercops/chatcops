export interface TurnstileConfig {
  secretKey: string;
  /** Expected action to validate against the Turnstile response. */
  action?: string;
  /** Expected hostnames where the challenge may be solved. */
  expectedHostnames?: string[];
  /** Timeout in milliseconds for the verification request. Defaults to 5000 ms. */
  timeoutMs?: number;
}

export type TurnstileResult =
  | { ok: true; hostname?: string; action?: string }
  | {
      ok: false;
      code:
        | 'missing_token'
        | 'invalid_token'
        | 'hostname_mismatch'
        | 'action_mismatch'
        | 'unavailable';
      errorCodes?: string[];
    };

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const DEFAULT_TIMEOUT_MS = 5000;

export async function verifyTurnstile(
  token: string | undefined,
  config: TurnstileConfig,
  opts?: {
    remoteIp?: string;
    idempotencyKey?: string;
    fetch?: typeof fetch;
  }
): Promise<TurnstileResult> {
  if (token === undefined || token === null || typeof token !== 'string' || token.trim() === '') {
    return { ok: false, code: 'missing_token' };
  }

  try {
    const body: Record<string, string> = {
      secret: config.secretKey,
      response: token,
    };

    if (opts?.remoteIp !== undefined && opts.remoteIp !== '') {
      body.remoteip = opts.remoteIp;
    }

    if (opts?.idempotencyKey !== undefined && opts.idempotencyKey !== '') {
      body.idempotency_key = opts.idempotencyKey;
    }

    const fetchFn = opts?.fetch ?? globalThis.fetch;
    const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let response: Response;
    try {
      response = await fetchFn(SITEVERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, code: 'unavailable' };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      return { ok: false, code: 'unavailable' };
    }

    if (
      typeof data !== 'object' ||
      data === null ||
      Array.isArray(data) ||
      typeof (data as Record<string, unknown>).success !== 'boolean'
    ) {
      return { ok: false, code: 'unavailable' };
    }

    const payload = data as {
      success: boolean;
      hostname?: string;
      action?: string;
      'error-codes'?: string[];
    };

    if (!response.ok) {
      if (response.status >= 500 || payload.success !== false) {
        return { ok: false, code: 'unavailable' };
      }
    }

    if (!payload.success) {
      const errorCodes = Array.isArray(payload['error-codes'])
        ? payload['error-codes'].map(String)
        : undefined;

      const isUnavailable = errorCodes?.includes('internal-error');

      const result: TurnstileResult = {
        ok: false,
        code: isUnavailable ? 'unavailable' : 'invalid_token',
      };
      if (errorCodes !== undefined) {
        result.errorCodes = errorCodes;
      }
      return result;
    }

    const returnedHostname = typeof payload.hostname === 'string' ? payload.hostname : undefined;
    const returnedAction = typeof payload.action === 'string' ? payload.action : undefined;

    if (config.expectedHostnames !== undefined) {
      if (
        !returnedHostname ||
        !config.expectedHostnames.some((expected) => expected.toLowerCase() === returnedHostname.toLowerCase())
      ) {
        return { ok: false, code: 'hostname_mismatch' };
      }
    }

    if (config.action !== undefined) {
      if (returnedAction !== config.action) {
        return { ok: false, code: 'action_mismatch' };
      }
    }

    const result: TurnstileResult = { ok: true };
    if (returnedHostname !== undefined) {
      result.hostname = returnedHostname;
    }
    if (returnedAction !== undefined) {
      result.action = returnedAction;
    }
    return result;
  } catch {
    return { ok: false, code: 'unavailable' };
  }
}
