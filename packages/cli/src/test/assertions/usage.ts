import { dollars } from '../cost.js';
import type { AssertionCheck } from '../types.js';
import { asLimit } from './values.js';

/** `tokens-under: 800` (input plus output), or `tokens-under: { input: 600, output: 200 }`. */
export const tokensUnder: AssertionCheck = (value, turn) => {
  const limits = readTokenLimits(value);
  const usage = turn.usage;
  if (!usage) throw new Error('the turn has no token usage to check');
  const checks = [
    { label: 'tokens', limit: limits.total, used: usage.inputTokens + usage.outputTokens },
    { label: 'input tokens', limit: limits.input, used: usage.inputTokens },
    { label: 'output tokens', limit: limits.output, used: usage.outputTokens },
  ].filter((check): check is { label: string; limit: number; used: number } => check.limit !== undefined);
  const over = checks.filter((check) => check.used >= check.limit);
  return over.length
    ? { pass: false, reason: `the turn used ${over.map(({ label, limit, used }) => `${used} ${label}, over the ${limit} limit`).join(', ')}` }
    : { pass: true, reason: `the turn used ${checks.map(({ label, limit, used }) => `${used} ${label} (limit ${limit})`).join(', ')}` };
};

function readTokenLimits(value: unknown): { total?: number; input?: number; output?: number } {
  if (typeof value === 'number') return { total: asLimit(value, 'tokens-under') };
  const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
  const keys = isObject ? Object.keys(value) : [];
  if (!keys.length || keys.some((key) => key !== 'input' && key !== 'output')) throw new Error('tokens-under takes a number, or { input, output }');
  const { input, output } = value as Record<string, unknown>;
  return {
    input: input === undefined ? undefined : asLimit(input, 'tokens-under'),
    output: output === undefined ? undefined : asLimit(output, 'tokens-under'),
  };
}

/** `latency-under: 3000`: the reply finished in under 3000 ms. */
export const latencyUnder: AssertionCheck = (value, turn) => {
  const limit = asLimit(value, 'latency-under');
  const took = Math.round(turn.latencyMs);
  return turn.latencyMs < limit
    ? { pass: true, reason: `the reply took ${took} ms (limit ${limit} ms)` }
    : { pass: false, reason: `the reply took ${took} ms, over the ${limit} ms limit` };
};

/** `cost-under: 0.01`: the turn cost under $0.01, from `prices` in the config. */
export const costUnder: AssertionCheck = (value, turn) => {
  const limit = asLimit(value, 'cost-under');
  if (!turn.usage) throw new Error('the turn has no token usage to check');
  if (turn.costUsd === undefined) {
    throw new Error(`the turn has no cost: add ${turn.model ? `"${turn.model}"` : 'the model'} to \`prices\` in the config`);
  }
  return turn.costUsd < limit
    ? { pass: true, reason: `the turn cost ${dollars(turn.costUsd)} (limit ${dollars(limit)})` }
    : { pass: false, reason: `the turn cost ${dollars(turn.costUsd)}, over the ${dollars(limit)} limit` };
};
