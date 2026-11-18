import { consoleLogger } from '@chatcops/core';
import type { ChatCopsServerConfig } from '../config.js';
import { corsHeaders, matchOrigin } from './origin.js';
import { rejectRemovedOptions } from '../removed-options.js';

const MAX_REFUSAL_LOGS = 20;

/** `allowedOrigins`, or any origin. */
export function allowedOriginsOf(config: Pick<ChatCopsServerConfig, 'allowedOrigins'>): string[] {
  rejectRemovedOptions(config);
  if (config.allowedOrigins !== undefined) {
    if (config.allowedOrigins.length === 0) {
      throw new Error("`allowedOrigins` is empty, so no site could use the chat. List your sites, or use ['*'] for any site.");
    }
    return config.allowedOrigins;
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
export function originPolicy(config: Pick<ChatCopsServerConfig, 'allowedOrigins' | 'logger'>): OriginPolicy {
  const allowed = allowedOriginsOf(config);
  const logged = new Set<string>();
  const logger = config.logger ?? consoleLogger();

  const allows = (origin: string | null) => !origin || matchOrigin(origin, allowed) !== null;

  const headers = (origin: string | null): Record<string, string> => {
    if (allows(origin)) return corsHeaders(origin, allowed);
    // A refused page still gets its own origin back, so the widget can read
    // the 403 and say why in the console.
    if (logged.size < MAX_REFUSAL_LOGS && origin && !logged.has(origin)) {
      logged.add(origin);
      logger.warn('origin_refused', `Refused a request from ${origin}, which isn't in allowedOrigins.`, { origin });
    }
    return { 'Access-Control-Allow-Origin': origin ?? '', Vary: 'Origin' };
  };

  return {
    allows,
    headers,
    preflightHeaders: (origin) => ({
      ...headers(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-ChatCops-Protocol',
      'Access-Control-Max-Age': '86400',
    }),
  };
}

