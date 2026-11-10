import type { TestResult } from '../types.js';
import type { ReporterFactory } from './index.js';

/** One testcase per aggregate result, including when a test repeats. */
export const junitReporter: ReporterFactory = (output) => ({
  onEnd(results) {
    const groups = new Map<string, TestResult[]>();
    for (const result of results) {
      const group = groups.get(result.fixture) ?? [];
      group.push(result);
      groups.set(result.fixture, group);
    }
    const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites ${statistics(results)}>`];
    for (const [fixture, tests] of groups) {
      lines.push(`  <testsuite name="${xml(fixture)}" ${statistics(tests)}>`);
      for (const result of tests) {
        lines.push(`    <testcase classname="${xml(fixture)}" name="${xml(result.test)}" time="${seconds(latency(result))}">`);
        const outcome = problem(result);
        if (outcome) {
          const details: string[] = [];
          for (const run of result.runs) {
            if (run.error) details.push(`Run ${run.run}: ${run.error}`);
            for (const [index, { turn, results: checks }] of run.turns.entries()) {
              const failed = checks.filter((check) => !check.pass);
              if (!failed.length) continue;
              for (const check of failed) {
                details.push(`Run ${run.run}, turn ${index + 1}: ${check.reason ?? Object.keys(check.assertion)[0]}`);
              }
              details.push(`Reply: ${turn.text}`);
            }
          }
          lines.push(`      <${outcome} message="${outcome === 'error' ? 'Execution error' : 'Assertion failed'}">${xml(details.join('\n'))}</${outcome}>`);
        }
        lines.push('    </testcase>');
      }
      lines.push('  </testsuite>');
    }
    lines.push('</testsuites>');
    output.write(`${lines.join('\n')}\n`);
  },
});

function problem(result: TestResult): 'error' | 'failure' | undefined {
  // The aggregate pass-rate verdict wins. For a failed aggregate, any execution
  // error takes precedence over assertion failures, so each testcase counts once.
  if (result.pass) return undefined;
  return result.runs.some((run) => run.error !== undefined) ? 'error' : 'failure';
}

function latency(result: TestResult): number {
  return result.runs.reduce((total, run) => total + run.turns.reduce((sum, { turn }) => sum + turn.latencyMs, 0), 0);
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3);
}

function statistics(results: TestResult[]): string {
  return `tests="${results.length}" failures="${results.filter((r) => problem(r) === 'failure').length}" errors="${results.filter((r) => problem(r) === 'error').length}" time="${seconds(results.reduce((sum, r) => sum + latency(r), 0))}"`;
}

/** XML 1.0 characters and entities, including whitespace in attribute values. */
function xml(text: string): string {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#13;', '\n': '&#10;', '\t': '&#9;' };
  return text.replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '').replace(/[&<>"'\r\n\t]/g, (character) => entities[character]);
}
