import type { CounterStore } from '../storage/types.js';

export interface RateLimitRule {
  /** Maximum requests allowed per window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window, never below 0. */
  remaining: number;
  /** When denied: how long until a request would be allowed again. */
  retryAfterMs?: number;
}

export interface RateLimiterOptions {
  /** Key namespace; defaults to 'rl'. */
  prefix?: string;
  /** Seam for tests; defaults to Date.now. */
  now?: () => number;
}

/**
 * Sliding-window rate limiter built on two fixed-window counters.
 *
 * Two fixed windows — the current one and the previous one — give a smooth
 * sliding estimate without needing per-request timestamps:
 *
 *   estimate = prev × (1 − elapsed/windowMs) + current
 *
 * where `elapsed` is how far we are into the current window. At the boundary
 * the previous window fades out linearly, so the effective limit never exceeds
 * `limit` over any rolling window.
 *
 * retryAfterMs formula
 * --------------------
 * We want the smallest t (in ms from now) such that the estimate drops to
 * `limit`. All denied requests have already been counted, so `current` won't
 * change. As time advances by t, `elapsed` increases by t and `prev`'s weight
 * shrinks:
 *
 *   prev × (1 − (elapsed + t)/windowMs) + current ≤ limit
 *   prev × (1 − (elapsed + t)/windowMs) ≤ limit − current
 *
 * Rearranging (prev > 0 required, otherwise we'd already be under the limit):
 *
 *   1 − (elapsed + t)/windowMs ≤ (limit − current) / prev
 *   t ≥ windowMs × (1 − (limit − current) / prev) − elapsed
 *   t ≥ windowMs − elapsed − windowMs × (limit − current) / prev
 *
 * Clamped to [1, windowMs] to keep the estimate positive and bounded.
 */
export function createRateLimiter(
  counters: CounterStore,
  rule: RateLimitRule,
  options: RateLimiterOptions = {}
): { check(key: string): Promise<RateLimitResult> } {
  if (rule.limit <= 0) throw new Error('limit must be greater than 0');
  if (rule.windowMs <= 0) throw new Error('windowMs must be greater than 0');

  const prefix = options.prefix ?? 'rl';
  const now = options.now ?? Date.now;

  return {
    async check(key: string): Promise<RateLimitResult> {
      const t = now();
      const index = Math.floor(t / rule.windowMs);
      const elapsed = t - index * rule.windowMs;

      // Increment the current window. TTL is 2× so the previous window
      // stays readable for the whole next window period.
      const currentKey = `${prefix}:${key}:${index}`;
      const [currentEntry, prevEntry] = await Promise.all([
        counters.increment(currentKey, 1, 2 * rule.windowMs),
        counters.get(`${prefix}:${key}:${index - 1}`),
      ]);

      const current = currentEntry.value;
      const prev = prevEntry?.value ?? 0;

      // Sliding-window estimate: blend the previous window's tail.
      const estimate = prev * (1 - elapsed / rule.windowMs) + current;

      if (estimate <= rule.limit) {
        return { allowed: true, remaining: Math.max(0, Math.floor(rule.limit - estimate)) };
      }

      // Time (ms) until the estimate would drop back to limit.
      // Derived above; prev > 0 whenever estimate > limit and decay is possible.
      // When prev = 0 the counter only resets at the window boundary, so we wait
      // out the remainder of the current window.
      const retryAfterMs = prev > 0
        ? Math.min(rule.windowMs, Math.max(1, Math.ceil(rule.windowMs - elapsed - (rule.windowMs * (rule.limit - current)) / prev)))
        : Math.max(1, rule.windowMs - elapsed);

      return { allowed: false, remaining: 0, retryAfterMs };
    },
  };
}
