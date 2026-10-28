import type { AssertionCheck } from '../types.js';

function asLimit(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${name} takes a number of 0 or more`);
  return value;
}

/** `tokens-under: 800` (input plus output), or `tokens-under: { input: 600, output: 200 }`. */
export const tokensUnder: AssertionCheck = (value, turn) => {
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const limits: Record<string, unknown> = isObject ? (value as Record<string, unknown>) : { total: value };
  const keys = Object.keys(limits);
  if (isObject && (!keys.length || keys.some((key) => key !== 'input' && key !== 'output'))) {
    throw new Error('tokens-under takes a number, or { input, output }');
  }
  const wanted = keys.map((key) => ({ name: key as 'total' | 'input' | 'output', limit: asLimit(limits[key], 'tokens-under') }));
  if (!turn.usage) return { pass: false, reason: 'the turn has no token usage to check' };
  const counts = { total: turn.usage.inputTokens + turn.usage.outputTokens, input: turn.usage.inputTokens, output: turn.usage.outputTokens };
  const label = { total: 'tokens', input: 'input tokens', output: 'output tokens' };
  const checks = wanted.map(({ name, limit }) => ({ name, limit, used: counts[name] }));
  const over = checks.filter(({ limit, used }) => used >= limit);
  const describe = ({ name, limit, used }: (typeof checks)[number]) => `${used} ${label[name]} (limit ${limit})`;
  return over.length
    ? { pass: false, reason: `the turn used ${over.map(describe).join(', ')}` }
    : { pass: true, reason: `the turn used ${checks.map(describe).join(', ')}` };
};

/** `latency-under: 3000`: the reply finished in under 3000 ms. */
export const latencyUnder: AssertionCheck = (value, turn) => {
  const limit = asLimit(value, 'latency-under');
  return turn.latencyMs < limit
    ? { pass: true, reason: `the reply took ${turn.latencyMs} ms (limit ${limit})` }
    : { pass: false, reason: `the reply took ${turn.latencyMs} ms, over the ${limit} ms limit` };
};

/** `cost-under: 0.01`: the turn cost under $0.01, from `prices` in the config. */
export const costUnder: AssertionCheck = (value, turn) => {
  const limit = asLimit(value, 'cost-under');
  if (turn.costUsd === undefined) {
    return { pass: false, reason: `the turn has no cost: add ${turn.model ? `"${turn.model}"` : 'the model'} to \`prices\` in the config` };
  }
  return turn.costUsd < limit
    ? { pass: true, reason: `the turn cost $${turn.costUsd} (limit $${limit})` }
    : { pass: false, reason: `the turn cost $${turn.costUsd}, over the $${limit} limit` };
};
