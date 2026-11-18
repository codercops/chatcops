/** The longest delay `setTimeout` holds (2^31 - 1 ms, about 24.8 days); a longer one fires at once. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * A delay for `setTimeout`: the number itself, the maximum for anything longer
 * (a huge delay means "much later", not "now"), and `undefined` for what is not
 * a delay: `NaN`, a negative number, or not a number at all.
 */
export function timerDelay(value: unknown): number | undefined {
  return typeof value === 'number' && value >= 0 ? Math.min(value, MAX_TIMER_DELAY_MS) : undefined;
}
