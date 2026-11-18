import { describe, expect, it } from 'vitest';
import { prettyReporter } from '../src/test/reporters/pretty.js';
import type { RunSummary } from '../src/test/reporters/index.js';
import type { AssertionResult, TestResult, TestRunResult, TurnResult } from '../src/test/types.js';

const summary: RunSummary = { mode: 'live', model: 'bot-model-1', elapsedMs: 230, costIncomplete: false };

function assertion(pass: boolean, reason: string): AssertionResult {
  return { assertion: { contains: reason }, pass, reason };
}

function turn(results: AssertionResult[], text = 'A sample reply.'): TestRunResult['turns'][number] {
  const value: TurnResult = { user: 'question', text, toolCalls: [], sources: [], leads: [], latencyMs: 1 };
  return { turn: value, results };
}

function result(
  fixture: string,
  test: string,
  runs: TestRunResult[],
  pass = runs.every((run) => run.pass)
): TestResult {
  return { fixture, test, runs, passRate: pass ? 1 : 0, pass };
}

function runResult(run: number, pass: boolean, turns: TestRunResult['turns'], error?: string): TestRunResult {
  return { fixture: 'evals/a.chat.yaml', test: 'sample', run, pass, turns, ...(error ? { error } : {}) };
}

function render(
  results: TestResult[],
  options: { verbose?: boolean; isTTY?: boolean; env?: Record<string, string | undefined>; summary?: RunSummary } = {},
  durations = results.map((_, index) => 100 + index)
): string {
  let output = '';
  results.forEach((value, index) => {
    value.durationMs = durations[index];
  });
  const reportOutput = { write: (text: string) => (output += text), isTTY: options.isTTY };
  const reporter = prettyReporter(reportOutput, { verbose: options.verbose, env: options.env ?? {} });
  reporter.onEnd?.(results, options.summary ?? summary);
  return output;
}

describe('pretty reporter', () => {
  it('buffers out-of-order completions and keeps file and test definition order', () => {
    const first = result('first.yaml', 'first test', [runResult(1, true, [])]);
    const second = result('second.yaml', 'second test', [runResult(1, true, [])]);
    let output = '';
    second.durationMs = 20;
    first.durationMs = 10;
    const reportOutput = { write: (text: string) => (output += text) };
    const reporter = prettyReporter(reportOutput, { env: {} });
    expect(output).toBe('');
    reporter.onEnd?.([first, second], summary);
    expect(output.indexOf('first.yaml')).toBeLessThan(output.indexOf('second.yaml'));
    expect(output).toContain('first test  10 ms');
    expect(output).toContain('second test  20 ms');
    expect(output).toContain('\nSummary\n');
  });

  it('wraps long verbose explanations and separates test detail blocks', () => {
    const explanation = 'This explanation is deliberately long so that the reporter must wrap the words into readable continuation lines without dropping any information.';
    const first = result('a.yaml', 'first', [runResult(1, true, [turn([assertion(true, explanation)])])]);
    const second = result('a.yaml', 'second', [runResult(1, true, [turn([])])]);
    const report = render([first, second], { verbose: true });
    expect(report.replace(/\s+/g, ' ')).toContain(explanation);
    expect(report).toMatch(/\n {8}\S/);
    expect(report).toContain('\n\n  ✓ second');
    expect(report).toContain('No assertions for this turn.');
  });

  it('hides assertion details for a passing test by default', () => {
    const passing = result('evals/a.chat.yaml', 'works', [runResult(1, true, [turn([assertion(true, 'the answer is good')])])]);
    const report = render([passing]);

    expect(report).toContain('  ✓ works  100 ms');
    expect(report).not.toContain('the answer is good');
    expect(report).toContain('Assertions: 1 passed, 0 failed');
  });

  it('shows passing and failing assertions, plus a clipped reply, for failed tests', () => {
    const text = 'x'.repeat(250);
    const failed = result('evals/a.chat.yaml', 'fails', [
      runResult(1, false, [turn([assertion(true, 'it has a title'), assertion(false, 'it has the requested detail')], text)]),
    ]);
    const report = render([failed]);

    expect(report).toContain('✓ turn 1: it has a title');
    expect(report).toContain('✗ turn 1: it has the requested detail');
    expect(report).toContain(`reply: ${'x'.repeat(199)}…`);
    expect(report).not.toContain(text);
  });

  it('shows every repeated run and turn in verbose mode, including passing tests', () => {
    const repeated = result('evals/a.chat.yaml', 'repeats', [
      runResult(1, true, [turn([assertion(true, 'first assertion')]), turn([assertion(true, 'second assertion')])]),
      runResult(2, true, [turn([assertion(true, 'third assertion')]), turn([assertion(true, 'fourth assertion')])]),
    ]);
    const report = render([repeated], { verbose: true });

    expect(report).toContain('(2/2 runs)');
    for (const label of ['Run 1', 'Run 2']) expect(report).toContain(label);
    expect(report).not.toContain('Turn ');
    for (const reason of ['first assertion', 'second assertion', 'third assertion', 'fourth assertion']) expect(report).toContain(reason);
  });

  it('includes successful repeated runs when the overall test fails', () => {
    const repeated = result('evals/a.chat.yaml', 'repeats', [
      runResult(1, true, [turn([assertion(true, 'the first run passed')])]),
      runResult(2, false, [turn([assertion(false, 'the second run failed')])]),
    ]);
    const report = render([repeated]);

    expect(report).toContain('(1/2 runs)');
    expect(report).toContain('Run 1');
    expect(report).toContain('✓ turn 1: the first run passed');
    expect(report).toContain('Run 2');
    expect(report).toContain('✗ turn 1: the second run failed');
    expect(report).not.toContain('Turn ');
  });

  it('groups files in result order and reports test durations separately from total elapsed time', () => {
    const tests = [
      result('evals/first.chat.yaml', 'first', [runResult(1, true, [])]),
      result('evals/first.chat.yaml', 'second', [runResult(1, true, [])]),
      result('evals/second.chat.yaml', 'third', [runResult(1, true, [])]),
    ];
    const report = render(tests, { summary: { ...summary, elapsedMs: 230 } }, [85, 145, 95]);

    expect(report.indexOf('evals/first.chat.yaml')).toBeLessThan(report.indexOf('evals/second.chat.yaml'));
    expect(report.match(/evals\/first\.chat\.yaml/g)).toHaveLength(1);
    expect(report).toContain('  ✓ first  85 ms');
    expect(report).toContain('  ✓ second  145 ms');
    expect(report).toContain('Elapsed: 230 ms');
    expect(render(tests.slice(0, 1), { summary: { ...summary, elapsedMs: 1240 } }, [1240])).toContain('  ✓ first  1.24 s');
  });

  it('counts assertions across runs and reports partial bot usage without implying judge tokens', () => {
    const partialTurn: TurnResult = {
      user: 'next',
      text: 'reply',
      toolCalls: [],
      sources: [],
      leads: [],
      latencyMs: 1,
      usage: { inputTokens: 7, outputTokens: 3 },
    };
    const multiRun = result('evals/a.chat.yaml', 'usage', [
      runResult(1, true, [turn([assertion(true, 'first')])]),
      runResult(2, false, [{ turn: partialTurn, results: [assertion(false, 'second')] }]),
    ]);
    const report = render([multiRun], {
      summary: { ...summary, judge: 'grader:model', costUsd: 0.01, costIncomplete: true },
    });

    expect(report).toContain('0 passed, 1 failed. Spent about $0.0100 (partial; some calls could not be priced). Judged by grader:model.');
    expect(report).toContain('Assertions: 1 passed, 1 failed');
    expect(report).toContain('Bot tokens (partial; reported for 1 of 2 turns): 7 input + 3 output = 10 total');
  });

  it('does not invent assertions or costs for runtime errors and keeps replay spending clear', () => {
    const failed = result('evals/a.chat.yaml', 'provider error', [runResult(1, false, [], 'provider unavailable')], false);
    const report = render(
      [failed],
      { summary: { ...summary, mode: 'replay', costUsd: 1, costIncomplete: true } }
    );

    expect(report).toContain('Run 1: provider unavailable');
    expect(report).toContain('Assertions: 0 passed, 0 failed');
    expect(report).toContain('Replayed, nothing spent.');
    expect(report).not.toContain('Spent about');
    expect(render([failed], { summary: { ...summary, mode: 'live' } })).toContain('0 passed, 1 failed.\n');
  });

  it('colors only an injected TTY and always respects NO_COLOR and non-TTY output', () => {
    const passing = result('evals/a.chat.yaml', 'works', [runResult(1, true, [])]);

    expect(render([passing], { isTTY: true })).toContain('\u001b[');
    expect(render([passing], { isTTY: true, env: { NO_COLOR: '' } })).not.toContain('\u001b[');
    expect(render([passing], { isTTY: true, env: { NO_COLOR: '', FORCE_COLOR: '1' } })).not.toContain('\u001b[');
    expect(render([passing], { isTTY: false, env: { FORCE_COLOR: '1' } })).not.toContain('\u001b[');
  });

  it('labels absent model metadata as unavailable', () => {
    const passing = result('evals/a.chat.yaml', 'works', [runResult(1, true, [])]);

    expect(render([passing], { summary: { mode: 'live', elapsedMs: 230, costIncomplete: false } })).toContain('Model: unavailable');
  });
});
