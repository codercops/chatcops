import { relative } from 'node:path';
import type { ChatCopsServerConfig } from '@chatcops/server';
import { ConfigError } from '../config.js';
import { EXIT, wholeNumber, type Io, type Values } from '../main.js';
import { unknownAssertions } from './assertions/index.js';
import { DEFAULT_PATTERN, findFixtures, loadFixture, matchesFilter } from './load.js';
import type { CassetteMode, Cassettes } from './cassette.js';
import { runFixtures, withMocks, type FixtureJob } from './run.js';
import { REPORTERS } from './reporters/index.js';

/** `chatcops test`: finds and checks the eval files, runs them, reports. Exit 0 all passed, 1 some failed, 2 couldn't run. */
export async function runTests(server: ChatCopsServerConfig, patterns: string[], values: Values, io: Io, cassettes?: Cassettes): Promise<number> {
  const concurrency = wholeNumber(values.concurrency, '--concurrency');
  const repeat = wholeNumber(values.repeat, '--repeat');
  if (repeat === 0) throw new ConfigError('--repeat takes 1 or more.');

  const files = await findFixtures(io.cwd, patterns.length ? patterns : [DEFAULT_PATTERN]);
  if (!files.length) throw new ConfigError(`No eval files match ${(patterns.length ? patterns : [DEFAULT_PATTERN]).join(', ')}.`);

  const fixtures: FixtureJob[] = [];
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
    if (tests.length) fixtures.push({ file: relative(io.cwd, file), path: file, fixture, tests });
  }
  if (!fixtures.length) throw new ConfigError(`No tests match --filter ${values.filter}.`);

  const reporters = (values.reporter?.length ? values.reporter : [values.json ? 'json' : 'pretty']).map((name) => {
    const reporter = REPORTERS.get(name);
    if (!reporter) throw new ConfigError(`--reporter ${name} doesn't exist. Use one of: ${[...REPORTERS.keys()].join(', ')}.`);
    return reporter(io.stdout);
  });
  if (values.json && values.reporter?.length) throw new ConfigError('Use --reporter json, or --json, not both.');

  if (cassettes) {
    await cassettes.load(fixtures.map((job) => job.path ?? job.file));
    if (cassettes.mode === 'replay') io.stderr.write(`Replaying recorded API calls${values.replay ? '' : ' (CI is set)'}. Run with --record to update them.\n`);
    if (cassettes.mode === 'record') io.stderr.write('Recording API calls.\n');
  }

  const results = await runFixtures(server, fixtures, {
    ...(cassettes ? { cassettes } : {}),
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(repeat !== undefined ? { repeat } : {}),
    onResult: (result) => {
      for (const reporter of reporters) reporter.onResult?.(result);
    },
  });
  for (const reporter of reporters) await reporter.onEnd?.(results);
  if (cassettes?.mode === 'record') {
    const written = await cassettes.save(
      fixtures.map((job) => ({ path: job.path ?? job.file, ran: job.tests.map((t) => t.name), all: job.fixture.tests.map((t) => t.name) }))
    );
    for (const file of written) io.stderr.write(`Saved ${relative(io.cwd, file)}\n`);
  }
  return results.some((result) => !result.pass) ? EXIT.problems : EXIT.ok;
}

/** `--record`, `--replay` or `--live`; with none of them, replay when `CI` is set and call the APIs otherwise. */
export function cassetteMode(values: Values, env: Record<string, string | undefined>): CassetteMode {
  const chosen = (['record', 'replay', 'live'] as const).filter((mode) => values[mode]);
  if (chosen.length > 1) throw new ConfigError(`Pick one of --${chosen.join(', --')}.`);
  if (chosen.length) return chosen[0];
  return env.CI && env.CI !== 'false' && env.CI !== '0' ? 'replay' : 'live';
}
