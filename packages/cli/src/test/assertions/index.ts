import type { Assertion, AssertionCheck, AssertionContext, AssertionResult, TurnResult } from '../types.js';
import { judge } from './judge.js';
import { javascript } from './javascript.js';
import { cites, leadCaptured } from './parts.js';
import { contains } from './text.js';
import { callsTool, noToolCall } from './tools.js';
import { costUnder, latencyUnder, tokensUnder } from './usage.js';

/**
 * The checks an eval file can use, by key. Every key also works with a
 * `not-` prefix, which passes when the check fails (`not-contains`).
 *
 * To add one, write it in its own file in this folder and add it here.
 */
export const ASSERTIONS = new Map<string, AssertionCheck>([
  ['contains', contains],
  ['javascript', javascript],
  ['judge', judge],
  ['tokens-under', tokensUnder],
  ['latency-under', latencyUnder],
  ['cost-under', costUnder],
  ['cites', cites],
  ['lead-captured', leadCaptured],
  ['calls-tool', callsTool],
  ['no-tool-call', noToolCall],
]);

/** The base name of an assertion and whether it's negated: `not-contains` is `contains`, negated. */
export function assertionName(assertion: Assertion): { key: string; name: string; negated: boolean } {
  const [key] = Object.keys(assertion);
  const negated = key.startsWith('not-') && ASSERTIONS.has(key.slice(4));
  return { key, name: negated ? key.slice(4) : key, negated };
}

/** Assertion keys a fixture uses that no check exists for. */
export function unknownAssertions(assertions: Assertion[]): string[] {
  return [...new Set(assertions.map(assertionName).filter(({ name }) => !ASSERTIONS.has(name)).map(({ key }) => key))];
}

export async function check(assertion: Assertion, turn: TurnResult, conversation: TurnResult[], context: AssertionContext = { fixture: '' }): Promise<AssertionResult> {
  const { key, name, negated } = assertionName(assertion);
  const run = ASSERTIONS.get(name);
  if (!run) return { assertion, pass: false, reason: `unknown assertion "${key}"` };
  try {
    const result = await run(assertion[key], turn, conversation, context);
    if (!negated) return { assertion, ...result };
    return { assertion, ...result, pass: !result.pass, reason: result.pass ? `expected not: ${result.reason ?? name}` : result.reason };
  } catch (error) {
    return { assertion, pass: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
