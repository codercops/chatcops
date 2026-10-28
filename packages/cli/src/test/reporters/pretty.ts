import type { TestResult } from '../types.js';
import type { ReporterFactory } from './index.js';

/** For people: a line per test as it finishes, the reasons under a failure, and the counts. */
export const prettyReporter: ReporterFactory = (output) => ({
  onResult(result) {
    output.write(pretty(result));
  },
  onEnd(results) {
    const failed = results.filter((result) => !result.pass).length;
    output.write(`\n${results.length - failed} passed, ${failed} failed.\n`);
  },
});

export function pretty(result: TestResult): string {
  const rate = result.runs.length > 1 ? ` (${result.runs.filter((run) => run.pass).length}/${result.runs.length} runs)` : '';
  const head = `${result.pass ? '✓' : '✗'} ${result.fixture} > ${result.test}${rate}\n`;
  if (result.pass) return head;

  const lines: string[] = [];
  const failedRun = result.runs.find((run) => !run.pass);
  if (failedRun) {
    failedRun.turns.forEach(({ turn, results }, i) => {
      for (const check of results.filter((r) => !r.pass)) lines.push(`    turn ${i + 1}: ${check.reason ?? Object.keys(check.assertion)[0]}`);
      if (results.some((r) => !r.pass)) lines.push(`    reply: ${clip(turn.text)}`);
    });
    if (failedRun.error) lines.push(`    ${failedRun.error}`);
  }
  return `${head}${lines.map((line) => `${line}\n`).join('')}`;
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat ? (flat.length > 200 ? `${flat.slice(0, 199)}…` : flat) : '(empty)';
}
