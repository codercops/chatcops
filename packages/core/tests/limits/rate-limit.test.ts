import { describe, expect, it } from 'vitest';
import { memoryStorage } from '../../src/storage/memory.js';
import type { CounterStore } from '../../src/storage/types.js';
import { createRateLimiter } from '../../src/limits/rate-limit.js';

/** Simple mutable clock for deterministic tests. */
function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => { t += ms; },
  };
}

/** Returns the CounterStore from memoryStorage — always present. */
function countersOf(options?: Parameters<typeof memoryStorage>[0]): CounterStore {
  return memoryStorage(options).counters as CounterStore;
}

describe('createRateLimiter', () => {
  it('throws on invalid rule', () => {
    const counters = countersOf();
    expect(() => createRateLimiter(counters, { limit: 0, windowMs: 1000 })).toThrow('limit must be greater than 0');
    expect(() => createRateLimiter(counters, { limit: -1, windowMs: 1000 })).toThrow('limit must be greater than 0');
    expect(() => createRateLimiter(counters, { limit: 5, windowMs: 0 })).toThrow('windowMs must be greater than 0');
    expect(() => createRateLimiter(counters, { limit: 5, windowMs: -1 })).toThrow('windowMs must be greater than 0');
  });

  it('allows exactly limit requests and blocks the next one', async () => {
    const time = clock();
    const limiter = createRateLimiter(countersOf({ now: time.now }), { limit: 5, windowMs: 60_000 }, { now: time.now });

    for (let i = 0; i < 5; i++) {
      const result = await limiter.check('user-1');
      expect(result.allowed).toBe(true);
    }

    const denied = await limiter.check('user-1');
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    expect(denied.retryAfterMs).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('remaining is never below 0', async () => {
    const time = clock();
    const limiter = createRateLimiter(countersOf({ now: time.now }), { limit: 2, windowMs: 10_000 }, { now: time.now });

    await limiter.check('u');
    await limiter.check('u');
    const result = await limiter.check('u');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('count decays across the window boundary — half the previous window still counts at the midpoint', async () => {
    const windowMs = 10_000;
    const time = clock();
    const limiter = createRateLimiter(countersOf({ now: time.now }), { limit: 10, windowMs }, { now: time.now });

    // Exhaust the limit in window 0.
    for (let i = 0; i < 10; i++) {
      await limiter.check('u');
    }
    const denied = await limiter.check('u');
    expect(denied.allowed).toBe(false);

    // Move to the start of window 1 — previous window still fully counts.
    time.advance(windowMs);
    const atStart = await limiter.check('u');
    expect(atStart.allowed).toBe(false);

    // Advance to the midpoint of window 1 (elapsed = windowMs/2).
    // At this point prev weight = 0.5, so the previous 10 requests contribute 5.
    // One new request was just made above, so estimate ≈ 5 + 1 = 6 < limit=10 — allowed.
    // Then 4 more should still pass (total current ≈ 5, estimate ≈ 5+5=10 — blocked on the 5th).
    time.advance(windowMs / 2);
    const midResult = await limiter.check('u');
    expect(midResult.allowed).toBe(true);
  });

  it('independent keys do not affect each other', async () => {
    const time = clock();
    const limiter = createRateLimiter(countersOf({ now: time.now }), { limit: 1, windowMs: 60_000 }, { now: time.now });

    await limiter.check('alice');
    const blocked = await limiter.check('alice');
    expect(blocked.allowed).toBe(false);

    // bob hasn't been seen yet — should be allowed
    const bobResult = await limiter.check('bob');
    expect(bobResult.allowed).toBe(true);
  });

  it('retryAfterMs is set when denied and within [1, windowMs]', async () => {
    const windowMs = 30_000;
    const time = clock(5_000); // start at 5s into the epoch so we're in window 0
    const limiter = createRateLimiter(countersOf({ now: time.now }), { limit: 3, windowMs }, { now: time.now });

    await limiter.check('x');
    await limiter.check('x');
    await limiter.check('x');
    const denied = await limiter.check('x');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThanOrEqual(1);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(windowMs);
  });

  it('prefix option namespaces keys so two limiters on the same store are independent', async () => {
    const time = clock();
    const counters = countersOf({ now: time.now });

    const authLimiter = createRateLimiter(counters, { limit: 2, windowMs: 60_000 }, { prefix: 'auth', now: time.now });
    const apiLimiter = createRateLimiter(counters, { limit: 2, windowMs: 60_000 }, { prefix: 'api', now: time.now });

    await authLimiter.check('ip-1');
    await authLimiter.check('ip-1');
    const authBlocked = await authLimiter.check('ip-1');
    expect(authBlocked.allowed).toBe(false);

    // Same key, different prefix — api limiter sees 0 previous requests.
    const apiAllowed = await apiLimiter.check('ip-1');
    expect(apiAllowed.allowed).toBe(true);
  });

  it('denied requests still count — a hammering client stays limited', async () => {
    const time = clock();
    const limiter = createRateLimiter(countersOf({ now: time.now }), { limit: 3, windowMs: 10_000 }, { now: time.now });

    for (let i = 0; i < 3; i++) await limiter.check('hammer');

    // Send 10 more denied requests.
    for (let i = 0; i < 10; i++) await limiter.check('hammer');

    // Advance a tiny bit — not far enough to decay below the limit.
    time.advance(100);
    const result = await limiter.check('hammer');
    expect(result.allowed).toBe(false);
  });

  it('30 concurrent check() calls against limit=10 allow exactly 10', async () => {
    const time = clock();
    const limiter = createRateLimiter(countersOf({ now: time.now }), { limit: 10, windowMs: 60_000 }, { now: time.now });

    const results = await Promise.all(Array.from({ length: 30 }, () => limiter.check('concurrent')));
    const allowed = results.filter((r) => r.allowed).length;
    expect(allowed).toBe(10);
  });
});
