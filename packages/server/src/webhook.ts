import type { WebhookConfig } from '@chatcops/core';

/**
 * The JSON body of every delivery. `event` and `timestamp` repeat `type` and
 * `created` for receivers written against the old format.
 */
export interface WebhookEvent<T = unknown> {
  /** Unique per event, and the same on every retry, so receivers can drop duplicates. */
  id: string;
  type: string;
  /** Milliseconds since the epoch. */
  created: number;
  data: T;
  /** @deprecated Same as `type`. */
  event: string;
  /** @deprecated Same as `created`. */
  timestamp: number;
}

export const DEFAULT_WEBHOOK_TIMEOUT_MS = 5000;
export const SIGNATURE_HEADER = 'X-ChatCops-Signature';
/** Signatures older than this are rejected by `verifyWebhook` by default. */
export const DEFAULT_SIGNATURE_TOLERANCE_SEC = 300;

const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 10_000;

/**
 * Throws when a webhook URL isn't safe to call from a server: anything other
 * than https, and hosts on loopback, private or link-local networks (which
 * includes cloud metadata endpoints such as 169.254.169.254). Set
 * `allowPrivateNetwork: true` on the webhook to call one of those on purpose,
 * for example a receiver on localhost during development.
 *
 * Only literal addresses are checked; a hostname that resolves to a private
 * address isn't. Hosted deployments should also block private ranges at the
 * network level.
 */
export function assertSafeWebhookUrl(rawUrl: string, allowPrivateNetwork = false): URL {
  const url = new URL(rawUrl); // throws on invalid URL
  if (allowPrivateNetwork) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`Webhook URL must use https or http: ${rawUrl}`);
    }
    return url;
  }
  if (url.protocol !== 'https:') {
    throw new Error(`Webhook URL must use https: ${rawUrl}. Set allowPrivateNetwork: true for a local http receiver.`);
  }
  if (isPrivateHost(url.hostname)) {
    throw new Error(
      `Webhook URL points at a private or local address: ${rawUrl}. Set allowPrivateNetwork: true if that's intended.`
    );
  }
  return url;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 // multicast and reserved
    );
  }

  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    // IPv4-mapped addresses. URL parsing turns ::ffff:10.0.0.1 into ::ffff:a00:1.
    const mappedDotted = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mappedDotted) return isPrivateHost(mappedDotted[1]);
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const [high, low] = [parseInt(mappedHex[1], 16), parseInt(mappedHex[2], 16)];
      return isPrivateHost(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(host); // unique local, link-local
  }

  return false;
}

export class WebhookDispatcher {
  private configs: WebhookConfig[];
  private timeoutMs: number;

  constructor(configs: WebhookConfig[], timeoutMs: number = DEFAULT_WEBHOOK_TIMEOUT_MS) {
    for (const config of configs) {
      assertSafeWebhookUrl(config.url, config.allowPrivateNetwork);
    }
    this.configs = configs;
    this.timeoutMs = timeoutMs;
  }

  async dispatch(event: string, data: unknown): Promise<void> {
    const matching = this.configs.filter((c) => c.events.includes(event) || c.events.includes('*'));
    if (matching.length === 0) return;

    const created = Date.now();
    const envelope: WebhookEvent = {
      id: `evt_${crypto.randomUUID()}`,
      type: event,
      created,
      data,
      event,
      timestamp: created,
    };
    const body = JSON.stringify(envelope);

    await Promise.allSettled(matching.map((config) => this.send(config, envelope, body)));
  }

  private async send(config: WebhookConfig, envelope: WebhookEvent, body: string): Promise<void> {
    let lastProblem = '';

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let retryAfterMs: number | undefined;
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-ChatCops-Event': envelope.type,
          'X-ChatCops-Event-Id': envelope.id,
        };
        if (config.secret) {
          headers[SIGNATURE_HEADER] = await signWebhook(body, config.secret);
        }

        const response = await fetch(config.url, {
          method: 'POST',
          headers,
          body,
          // A redirect could point anywhere, including a private address.
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) return;
        lastProblem = `HTTP ${response.status}`;

        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable) break;
        retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
      } catch (error) {
        lastProblem = error instanceof Error ? error.name : 'network error';
      }

      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, retryAfterMs ?? 2 ** (attempt - 1) * 1000));
      }
    }

    // Never log the body or the secret; they can hold lead details.
    console.error(
      `[chatcops] Webhook delivery failed: ${envelope.type} (${envelope.id}) to ${new URL(config.url).origin}: ${lastProblem}`
    );
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Builds the signature header value for a raw body:
 * `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 */
export async function signWebhook(body: string, secret: string, timestampSec = Math.floor(Date.now() / 1000)): Promise<string> {
  return `t=${timestampSec},v1=${await hmacHex(secret, `${timestampSec}.${body}`)}`;
}

/**
 * Checks a delivery on the receiving side. Pass the raw request body exactly
 * as received (not re-serialized JSON) and the `X-ChatCops-Signature` header.
 * Returns false for a bad signature or one older than `toleranceSec`.
 */
export async function verifyWebhook(options: {
  body: string;
  signature: string | null | undefined;
  secret: string;
  toleranceSec?: number;
  now?: number;
}): Promise<boolean> {
  const { body, signature, secret, toleranceSec = DEFAULT_SIGNATURE_TOLERANCE_SEC } = options;
  if (!signature) return false;

  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    })
  );
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1) return false;

  const nowSec = Math.floor((options.now ?? Date.now()) / 1000);
  if (Math.abs(nowSec - timestamp) > toleranceSec) return false;

  const expected = await hmacHex(secret, `${timestamp}.${body}`);
  return constantTimeEqual(expected, parts.v1);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
