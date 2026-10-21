/**
 * The visitor's IP, for per-IP rate limits and budgets. Only headers a
 * platform sets itself are read, never ones a visitor can send. When the IP
 * can't be told, per-IP limits are skipped for that request (with one
 * warning) instead of every visitor sharing one bucket.
 */

/** Reads the visitor's IP from a request, for hosts the adapter doesn't know. */
export type ClientIpResolver = (request: Request) => string | null | undefined;

const DOCS = 'https://chat.codercops.com/server/fetch-runtimes/#the-visitors-ip';

// IPv4, IPv6 (including IPv4-mapped) and nothing else, so a header can't
// carry an arbitrary counter key.
const IP_PATTERN = /^[0-9A-Fa-f:.]{2,45}$/;

export function cleanIp(value: string | null | undefined): string | undefined {
  const ip = value?.split(',')[0]?.trim();
  return ip && IP_PATTERN.test(ip) ? ip : undefined;
}

/** Vercel overwrites these headers, so a visitor can't set them there. */
export function onVercel(): boolean {
  return typeof process !== 'undefined' && Boolean(process.env?.VERCEL);
}

const warned = new Set<string>();

export function warnOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

/** For tests. */
export function resetClientIpWarnings(): void {
  warned.clear();
}

/** The fetch handler for Vercel and other Fetch API runtimes. */
export function fetchClientIp(request: Request, resolver: ClientIpResolver | undefined): string | undefined {
  if (resolver) return cleanIp(resolver(request));
  if (onVercel()) {
    const headers = request.headers;
    return cleanIp(headers.get('x-vercel-forwarded-for')) ?? cleanIp(headers.get('x-real-ip')) ?? cleanIp(headers.get('x-forwarded-for'));
  }
  warnOnce(
    'fetch',
    `[chatcops] Not running on Vercel, so the visitor's IP isn't read from X-Forwarded-For, which a visitor can set themselves. Per-IP rate limits and budgets are off until you set \`clientIp\`. See ${DOCS}`
  );
  return undefined;
}

/** Cloudflare sets CF-Connecting-IP on every request that reaches a Worker. */
export function cloudflareClientIp(request: Request, resolver: ClientIpResolver | undefined): string | undefined {
  if (resolver) return cleanIp(resolver(request));
  const ip = cleanIp(request.headers.get('cf-connecting-ip'));
  if (!ip) {
    warnOnce('cloudflare', '[chatcops] A request had no CF-Connecting-IP header, so per-IP rate limits and budgets were skipped for it.');
  }
  return ip;
}

interface ExpressLikeRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
  app?: { get?(setting: string): unknown };
}

/**
 * Express's `req.ip` follows its `trust proxy` setting. Behind a proxy with
 * that setting off, every visitor gets the proxy's address and shares one
 * rate limit and budget, so that case gets a warning.
 */
export function expressClientIp(req: ExpressLikeRequest): string | undefined {
  if (req.headers?.['x-forwarded-for'] !== undefined && !req.app?.get?.('trust proxy')) {
    warnOnce(
      'express',
      "[chatcops] A request had X-Forwarded-For, but Express's `trust proxy` setting is off, so the connection's IP is used. Behind a proxy that means every visitor gets the proxy's IP and shares one rate limit and budget. With one proxy in front, call app.set('trust proxy', 1)."
    );
  }
  return cleanIp(req.ip ?? req.socket?.remoteAddress);
}
