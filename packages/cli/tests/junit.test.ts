import { describe, expect, it } from 'vitest';
import { junitReporter } from '../src/test/reporters/junit.js';
import type { TestResult, TestRunResult } from '../src/test/types.js';

function run(overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    fixture: 'evals/pricing.chat.yaml', test: 'quotes the price', run: 1, pass: true,
    turns: [{ turn: { user: 'price?', text: '$19', latencyMs: 1200, toolCalls: [], sources: [], leads: [] }, results: [] }],
    ...overrides,
  };
}

function result(overrides: Partial<TestResult> = {}): TestResult {
  return { fixture: 'evals/pricing.chat.yaml', test: 'quotes the price', pass: true, passRate: 1, runs: [run()], durationMs: 99999, ...overrides };
}

async function report(results: TestResult[]): Promise<string> {
  let text = '';
  await junitReporter({ write: (chunk) => { text += chunk; } }, {}).onEnd?.(results, { mode: 'live', elapsedMs: 99999, costIncomplete: false });
  return text;
}

describe('JUnit reporter', () => {
  it('emits a complete XML document for a passing test, using turn latency rather than wall time', async () => {
    expect(await report([result()])).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="0" errors="0" time="1.200">
  <testsuite name="evals/pricing.chat.yaml" tests="1" failures="0" errors="0" time="1.200">
    <testcase classname="evals/pricing.chat.yaml" name="quotes the price" time="1.200">
    </testcase>
  </testsuite>
</testsuites>
`);
  });

  it('escapes attributes and failure details, with run, turn, reason and reply', async () => {
    const special = `<tag> & "quoted" 'single'`;
    const escaped = '&lt;tag&gt; &amp; &quot;quoted&quot; &apos;single&apos;';
    const failed = run({ pass: false });
    failed.turns.push({ turn: { ...failed.turns[0].turn, text: special, latencyMs: 300 }, results: [
      { assertion: { contains: 'x' }, pass: false, reason: special },
      { assertion: { equals: 'x' }, pass: false },
    ] });
    const xml = await report([result({ fixture: special, test: `${special}\u0000`, pass: false, runs: [failed] })]);
    expect(xml).toContain(`classname="${escaped}" name="${escaped}" time="1.500"`);
    expect(xml).toContain('<failure message="Assertion failed">');
    expect(xml).toContain(`Run 1, turn 2: ${escaped}&#10;Run 1, turn 2: equals&#10;Reply: ${escaped}</failure>`);
    expect(xml).not.toContain('\u0000');
    expect(xml).not.toContain('<error');
  });

  it('groups eval files and counts passing, assertion failures and execution errors once each', async () => {
    const failure = result({ test: 'fails', pass: false, runs: [run({ pass: false })] });
    const error = result({ fixture: 'evals/other.chat.yaml', test: 'throws', pass: false, runs: [run({ pass: false, error: 'provider <down> & unavailable' })] });
    const xml = await report([result(), failure, error]);
    expect(xml).toContain('<testsuites tests="3" failures="1" errors="1" time="3.600">');
    expect(xml).toContain('<testsuite name="evals/pricing.chat.yaml" tests="2" failures="1" errors="0" time="2.400">');
    expect(xml).toContain('<testsuite name="evals/other.chat.yaml" tests="1" failures="0" errors="1" time="1.200">');
    expect(xml.match(/<testcase /g)).toHaveLength(3);
    expect(xml).toContain('<error message="Execution error">Run 1: provider &lt;down&gt; &amp; unavailable</error>');
  });

  it('respects aggregate pass-rate verdicts and sums latency across all repeats', async () => {
    const runs = [run(), run({ run: 2, pass: false, error: 'failed repeat' })];
    const xml = await report([result({ runs, passRate: 0.5 })]);
    expect(xml).toContain('tests="1" failures="0" errors="0" time="2.400"');
    expect(xml).not.toMatch(/<(failure|error) /);
    const failed = await report([result({ runs, passRate: 0.5, pass: false })]);
    expect(failed).toContain('failures="0" errors="1"');
    expect(failed).toContain('Run 2: failed repeat');
  });

  it('gives execution errors precedence in a failed result with mixed runs', async () => {
    const failed = run({ pass: false });
    failed.turns[0].results.push({ assertion: { contains: 'x' }, pass: false, reason: 'missing x' });
    const xml = await report([result({ pass: false, runs: [failed, run({ run: 2, pass: false, error: 'model down' })] })]);
    expect(xml).toContain('<error message="Execution error">Run 1, turn 1: missing x&#10;Reply: $19&#10;Run 2: model down</error>');
    expect(xml).not.toContain('<failure');
  });

  it('emits a valid empty report', async () => {
    expect(await report([])).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<testsuites tests="0" failures="0" errors="0" time="0.000">\n</testsuites>\n');
  });
});
