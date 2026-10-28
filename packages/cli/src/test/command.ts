import { relative } from 'node:path';
import type { ChatCopsServerConfig } from '@chatcops/server';
import { ConfigError } from '../config.js';
import { EXIT, wholeNumber, type Io, type Values } from '../main.js';
import { unknownAssertions } from './assertions/index.js';
import { DEFAULT_PATTERN, findFixtures, loadFixture, matchesFilter } from './load.js';
import { runFixtures, withMocks } from './run.js';
import { REPORTERS } from './reporters/index.js';

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

  const reporters = (values.reporter?.length ? values.reporter : [values.json ? 'json' : 'pretty']).map((name) => {
    const reporter = REPORTERS.get(name);
    if (!reporter) throw new ConfigError(`--reporter ${name} doesn't exist. Use one of: ${[...REPORTERS.keys()].join(', ')}.`);
    return reporter(io.stdout);
  });
  if (values.json && values.reporter?.length) throw new ConfigError('Use --reporter json, or --json, not both.');

  const results = await runFixtures(server, fixtures, {
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(repeat !== undefined ? { repeat } : {}),
    onResult: (result) => {
      for (const reporter of reporters) reporter.onResult?.(result);
    },
  });
  for (const reporter of reporters) await reporter.onEnd?.(results);
  return results.some((result) => !result.pass) ? EXIT.problems : EXIT.ok;
}
