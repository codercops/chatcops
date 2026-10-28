import type { Assertion, AssertionCheck, AssertionResult, TurnResult } from './types.js';

/**
 * The checks a fixture can use, by key. Every key also works with a `not-`
 * prefix, which passes when the check fails (`not-contains`).
 */
export const ASSERTIONS = new Map<string, AssertionCheck>([
  [
    'contains',
    (value, turn) => {
      const wanted = asStrings(value, 'contains');
      const missing = wanted.filter((text) => !turn.text.includes(text));
      return missing.length
        ? { pass: false, reason: `the reply doesn't contain ${missing.map((text) => JSON.stringify(text)).join(', ')}` }
        : { pass: true, reason: `the reply contains ${wanted.map((text) => JSON.stringify(text)).join(', ')}` };
    },
  ],
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

export async function check(assertion: Assertion, turn: TurnResult, conversation: TurnResult[]): Promise<AssertionResult> {
  const { key, name, negated } = assertionName(assertion);
  const run = ASSERTIONS.get(name);
  if (!run) return { assertion, pass: false, reason: `unknown assertion "${key}"` };
  try {
    const result = await run(assertion[key], turn, conversation);
    if (!negated) return { assertion, ...result };
    return { assertion, ...result, pass: !result.pass, reason: result.pass ? `expected not: ${result.reason ?? name}` : result.reason };
  } catch (error) {
    return { assertion, pass: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function asStrings(value: unknown, name: string): string[] {
  const list = Array.isArray(value) ? value : [value];
  if (!list.length || list.some((item) => typeof item !== 'string')) throw new Error(`${name} takes a string or a list of strings`);
  return list as string[];
}
