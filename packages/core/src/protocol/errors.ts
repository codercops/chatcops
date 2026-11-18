import type { z } from 'zod';
import type { WireErrorCode, WireErrorBody } from './v1.js';

const STATUS_BY_CODE: Record<WireErrorCode, number> = {
  invalid_request: 400,
  content_filtered: 400,
  session_required: 401,
  token_expired: 401,
  conversation_mismatch: 401,
  turnstile_failed: 401,
  origin_not_allowed: 403,
  conversation_busy: 409,
  payload_too_large: 413,
  rate_limited: 429,
  budget_exceeded: 429,
  tool_error: 500,
  internal_error: 500,
  provider_error: 502,
  provider_unavailable: 503,
  timeout: 504,
};

export function statusForError(code: WireErrorCode): number {
  return STATUS_BY_CODE[code];
}

export function errorBody(
  code: WireErrorCode,
  options?: { message?: string; retryAfterMs?: number },
): WireErrorBody {
  const error: WireErrorBody['error'] = { code };
  if (options?.message !== undefined) {
    error.message = options.message;
  }
  if (options?.retryAfterMs !== undefined) {
    error.retryAfterMs = options.retryAfterMs;
  }
  return { error };
}

/** "Invalid request: message, pageContext.url". Field paths only, never values. */
export function describeInvalidRequest(error: z.ZodError): string {
  const paths = new Set<string>();
  for (const issue of error.issues) {
    paths.add(issue.path.length > 0 ? issue.path.join('.') : '(root)');
  }
  return paths.size > 0
    ? `Invalid request: ${Array.from(paths).join(', ')}`
    : 'Invalid request';
}
