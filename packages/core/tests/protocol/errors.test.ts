import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as core from '../../src/index.js';
import {
  describeInvalidRequest,
  errorBody,
  statusForError,
  type WireErrorCode,
} from '../../src/protocol/index.js';

describe('statusForError', () => {
  const EXPECTED_STATUSES: Record<WireErrorCode, number> = {
    invalid_request: 400,
    content_filtered: 400,
    session_required: 401,
    token_expired: 401,
    conversation_mismatch: 401,
    origin_not_allowed: 403,
    conversation_busy: 409,
    payload_too_large: 413,
    rate_limited: 429,
    budget_exceeded: 429,
    provider_error: 502,
    provider_unavailable: 503,
    timeout: 504,
    tool_error: 500,
    internal_error: 500,
  };

  it('maps every WireErrorCode to its HTTP status', () => {
    for (const [code, status] of Object.entries(EXPECTED_STATUSES)) {
      expect(statusForError(code as WireErrorCode)).toBe(status);
    }
  });

  it('is exported from @chatcops/core', () => {
    expect(core.statusForError).toBe(statusForError);
  });
});

describe('errorBody', () => {
  it('builds an error body without options', () => {
    const body = errorBody('invalid_request');
    expect(body).toEqual({ error: { code: 'invalid_request' } });
    expect(Object.keys(body.error)).toEqual(['code']);
    expect('message' in body.error).toBe(false);
    expect('retryAfterMs' in body.error).toBe(false);
    expect(JSON.stringify(body)).toBe('{"error":{"code":"invalid_request"}}');
  });

  it('builds an error body with message only', () => {
    const body = errorBody('invalid_request', { message: 'Invalid request: message' });
    expect(body).toEqual({ error: { code: 'invalid_request', message: 'Invalid request: message' } });
    expect(Object.keys(body.error)).toEqual(['code', 'message']);
    expect('retryAfterMs' in body.error).toBe(false);
  });

  it('builds an error body with retryAfterMs only', () => {
    const body = errorBody('rate_limited', { retryAfterMs: 60_000 });
    expect(body).toEqual({ error: { code: 'rate_limited', retryAfterMs: 60_000 } });
    expect(Object.keys(body.error)).toEqual(['code', 'retryAfterMs']);
    expect('message' in body.error).toBe(false);
  });

  it('builds an error body with all options', () => {
    const body = errorBody('rate_limited', {
      message: 'Rate limit exceeded',
      retryAfterMs: 5_000,
    });
    expect(body).toEqual({
      error: {
        code: 'rate_limited',
        message: 'Rate limit exceeded',
        retryAfterMs: 5_000,
      },
    });
    expect(Object.keys(body.error)).toEqual(['code', 'message', 'retryAfterMs']);
  });

  it('is exported from @chatcops/core', () => {
    expect(core.errorBody).toBe(errorBody);
  });
});

describe('describeInvalidRequest', () => {
  it('formats nested field paths', () => {
    const schema = z.object({
      message: z.string().min(1),
      pageContext: z.object({
        url: z.string().url(),
      }),
    });
    const result = schema.safeParse({ message: '', pageContext: { url: 'not-a-url' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(describeInvalidRequest(result.error)).toBe('Invalid request: message, pageContext.url');
    }
  });

  it('deduplicates multiple errors on the same field', () => {
    const schema = z.object({
      message: z.string().min(5).regex(/^[a-z]+$/),
    });
    const result = schema.safeParse({ message: '1' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(1);
      expect(describeInvalidRequest(result.error)).toBe('Invalid request: message');
    }
  });

  it('never includes received values in the error string', () => {
    const sensitiveValue = 'secret-token-do-not-leak';
    const schema = z.object({
      apiKey: z.string().min(100),
    });
    const result = schema.safeParse({ apiKey: sensitiveValue });
    expect(result.success).toBe(false);
    if (!result.success) {
      const description = describeInvalidRequest(result.error);
      expect(description).toBe('Invalid request: apiKey');
      expect(description).not.toContain(sensitiveValue);
    }
  });

  it('uses (root) when the error path is empty', () => {
    const schema = z.string().min(1);
    const result = schema.safeParse(42);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(describeInvalidRequest(result.error)).toBe('Invalid request: (root)');
    }
  });

  it('is exported from @chatcops/core', () => {
    expect(core.describeInvalidRequest).toBe(describeInvalidRequest);
  });
});
