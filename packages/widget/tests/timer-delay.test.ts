import { describe, expect, it } from 'vitest';
import { MAX_TIMER_DELAY_MS, timerDelay } from '../src/timer-delay.js';

describe('timerDelay', () => {
  it('knows the longest delay setTimeout holds', () => {
    expect(MAX_TIMER_DELAY_MS).toBe(2_147_483_647);
  });

  it.each([0, 1, 500, 3000, 86_400_000, MAX_TIMER_DELAY_MS])('returns %s as it is', (value) => {
    expect(timerDelay(value)).toBe(value);
  });

  it.each([MAX_TIMER_DELAY_MS + 1, 3_000_000_000, Number.MAX_SAFE_INTEGER, Number.MAX_VALUE, Number.POSITIVE_INFINITY])(
    'clamps %s to the maximum, since a delay that long means much later and not now',
    (value) => {
      expect(timerDelay(value)).toBe(MAX_TIMER_DELAY_MS);
    },
  );

  it.each([Number.NaN, -1, -0.5, -3000, Number.NEGATIVE_INFINITY])('has no delay for %s', (value) => {
    expect(timerDelay(value)).toBeUndefined();
  });

  it.each(['500', '', 'soon', null, undefined, true, false, {}, [], [5], BigInt(10)])('has no delay for %s, which is not a number', (value) => {
    expect(timerDelay(value)).toBeUndefined();
  });

  it('keeps a fraction, which setTimeout rounds down itself', () => {
    expect(timerDelay(2.5)).toBe(2.5);
  });

  it('treats -0 as 0', () => {
    expect(Object.is(timerDelay(-0), 0) || timerDelay(-0) === 0).toBe(true);
  });
});
