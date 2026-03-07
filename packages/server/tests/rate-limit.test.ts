import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from '../src/rate-limit.js';

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests within limit', () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });

    for (let i = 0; i < 5; i++) {
      const result = limiter.check('client-1');
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks requests over limit', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });

    limiter.check('client-1');
    limiter.check('client-1');
    limiter.check('client-1');

    const result = limiter.check('client-1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('resets after window expires', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 10_000 });

    limiter.check('client-1');
    limiter.check('client-1');
    expect(limiter.check('client-1').allowed).toBe(false);

    vi.advanceTimersByTime(10_001);
    expect(limiter.check('client-1').allowed).toBe(true);
  });

  it('tracks different clients independently', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });

    limiter.check('client-1');
    expect(limiter.check('client-1').allowed).toBe(false);
    expect(limiter.check('client-2').allowed).toBe(true);
  });

  it('throws on invalid maxRequests', () => {
    expect(() => new RateLimiter({ maxRequests: 0 })).toThrow('maxRequests must be greater than 0');
    expect(() => new RateLimiter({ maxRequests: -1 })).toThrow('maxRequests must be greater than 0');
  });

  it('throws on invalid windowMs', () => {
    expect(() => new RateLimiter({ windowMs: 0 })).toThrow('windowMs must be greater than 0');
    expect(() => new RateLimiter({ windowMs: -1000 })).toThrow('windowMs must be greater than 0');
  });

  it('cleans up expired entries', () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 10_000 });
    limiter.check('old-client');

    vi.advanceTimersByTime(10_001);
    limiter.cleanup();

    // Should allow full quota again
    const result = limiter.check('old-client');
    expect(result.allowed).toBe(true);
  });
});
