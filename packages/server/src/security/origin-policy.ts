import type { ChatCopsServerConfig } from '../config.js';
import { corsHeaders, matchOrigin } from './origin.js';

let warnedCors = false;
const MAX_REFUSAL_LOGS = 20;

/** `allowedOrigins`, or the older `cors` as a one-item list, or any origin. */
export function allowedOriginsOf(config: Pick<ChatCopsServerConfig, 'allowedOrigins' | 'cors'>): string[] {
  if (config.allowedOrigins !== undefined && config.cors !== undefined) {
    throw new Error('Set `allowedOrigins` or `cors`, not both. `allowedOrigins` replaces `cors`.');
  }
  if (config.allowedOrigins !== undefined) {
    if (config.allowedOrigins.length === 0) {
      throw new Error("`allowedOrigins` is empty, so no site could use the chat. List your sites, or use ['*'] for any site.");
    }
    return config.allowedOrigins;
  }
  if (config.cors !== undefined) {
    if (!warnedCors) {
      warnedCors = true;
      console.warn(`[chatcops] \`cors\` is deprecated. Use \`allowedOrigins: ['${config.cors}']\`, which also takes several sites and wildcards like 'https://*.acme.com'.`);
    }
    return [config.cors];
  }
  return ['*'];
}

export interface OriginPolicy {
  /** False for a browser request from a page whose origin isn't allowed. Requests without `Origin` pass. */
  allows(origin: string | null): boolean;
  /** CORS headers for any response to this origin, including errors. */
  headers(origin: string | null): Record<string, string>;
  /** Headers for the preflight answer. */
  preflightHeaders(origin: string | null): Record<string, string>;
}

/**
 * Which sites can use the chat. This stops other sites embedding your bot in
 * their pages; it doesn't stop scripts, which can send any `Origin`.
 */
export function originPolicy(config: Pick<ChatCopsServerConfig, 'allowedOrigins' | 'cors'>): OriginPolicy {
  const allowed = allowedOriginsOf(config);
  const logged = new Set<string>();

  const allows = (origin: string | null) => !origin || matchOrigin(origin, allowed) !== null;

  const headers = (origin: string | null): Record<string, string> => {
    if (allows(origin)) return corsHeaders(origin, allowed);
    // A refused page still gets its own origin back, so the widget can read
    // the 403 and say why in the console.
    if (logged.size < MAX_REFUSAL_LOGS && origin && !logged.has(origin)) {
      logged.add(origin);
      console.warn(`[chatcops] Refused a request from ${origin}, which isn't in allowedOrigins.`);
    }
    return { 'Access-Control-Allow-Origin': origin ?? '', Vary: 'Origin' };
  };

  return {
    allows,
    headers,
    preflightHeaders: (origin) => ({
      ...headers(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }),
  };
}

/** For tests. */
export function resetCorsWarning(): void {
  warnedCors = false;
}
