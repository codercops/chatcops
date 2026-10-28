import { relative } from 'node:path';
import type { ChatCopsServerConfig } from '@chatcops/server';
import { ConfigError } from '../config.js';
import { EXIT, wholeNumber, type Io, type Values } from '../main.js';
import { unknownAssertions } from './assertions.js';
import { DEFAULT_PATTERN, findFixtures, loadFixture, matchesFilter } from './load.js';
import { runFixtures, withMocks } from './run.js';
import type { TestResult } from './types.js';

/** `chatcops test`: finds and checks the eval files, runs them, reports. Exit 0 all passed, 1 some failed, 2 couldn't run. */
export async function runTests(server: ChatCopsServerConfig, patterns: string[], values: Values, io: Io): Promise<number> {
  const concurrency = wholeNumber(values.concurrency, '--concurrency');
  const repeat = wholeNumber(values.repeat, '--repeat');
  if (repeat === 0) throw new ConfigError('--repeat takes 1 or more.');

  const files = await findFixtures(io.cwd, patterns.length ? patterns : [DEFAULT_PATTERN]);
  if (!files.length) throw new ConfigError(`No eval files match ${(patterns.length ? patterns : [DEFAULT_PATTERN]).join(', ')}.`);

  const fixtures = [];
  for (const file of files) {
    const fixture = await loadFixture(file);
    const unknown = unknownAssertions(fixture.tests.flatMap((test) => test.turns.flatMap((turn) => turn.expect ?? [])));
    if (unknown.length) throw new ConfigError(`${relative(io.cwd, file)} uses assertions that don't exist: ${unknown.join(', ')}`);
    for (const test of fixture.tests) {
      try {
        withMocks(server.tools ?? [], test.mocks?.tools);
      } catch (error) {
        throw new ConfigError(`${relative(io.cwd, file)} > ${test.name}: ${(error as Error).message}`);
      }
    }
    const tests = fixture.tests.filter((test) => matchesFilter(test, values.filter));
    if (tests.length) fixtures.push({ file: relative(io.cwd, file), fixture, tests });
  }
  if (!fixtures.length) throw new ConfigError(`No tests match --filter ${values.filter}.`);

  const json = !!values.json;
  const results = await runFixtures(server, fixtures, {
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(repeat !== undefined ? { repeat } : {}),
    onResult: json ? undefined : (result) => io.stdout.write(pretty(result)),
  });

  const failed = results.filter((result) => !result.pass).length;
  if (json) {
    io.stdout.write(`${JSON.stringify({ passed: results.length - failed, failed, results })}\n`);
  } else {
    io.stdout.write(`\n${results.length - failed} passed, ${failed} failed.\n`);
  }
  return failed ? EXIT.problems : EXIT.ok;
}

/** One test's result for people: a line per test, the reasons under a failure. */
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
