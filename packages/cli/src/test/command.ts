import { relative } from 'node:path';
import { createProvider, isAIProvider, type AIProvider, type ProviderConfig } from '@chatcops/core';
import type { ChatCopsServerConfig } from '@chatcops/server';
import { ConfigError, type ChatCopsCliConfig } from '../config.js';
import { EXIT, wholeNumber, type Io, type Values } from '../main.js';
import { assertionName, unknownAssertions } from './assertions/index.js';
import { Spend } from './cost.js';
import { resolveJudge } from './judge.js';
import { DEFAULT_PATTERN, findFixtures, loadFixture, matchesFilter } from './load.js';
import type { CassetteMode, Cassettes } from './cassette.js';
import { runFixtures, withMocks, withoutKeys, type FixtureJob } from './run.js';
import { REPORTERS } from './reporters/index.js';

/** `chatcops test`: finds and checks the eval files, runs them, reports. Exit 0 all passed, 1 some failed, 2 couldn't run. */
export async function runTests(
  server: ChatCopsServerConfig,
  patterns: string[],
  values: Values,
  io: Io,
  cassettes?: Cassettes,
  cli: Pick<ChatCopsCliConfig, 'judge' | 'prices'> = {}
): Promise<number> {
  const mode = cassettes?.mode ?? 'live';
  const maxCost = positiveNumber(values['max-cost'], '--max-cost');
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

  // Started here so a missing key fails now, not as provider_unavailable on
  // every turn, and so turns can be priced by the model id.
  let bot: AIProvider;
  try {
    bot = isAIProvider(server.provider) ? server.provider : await createProvider((mode === 'replay' ? withoutKeys(server) : server).provider as ProviderConfig);
  } catch (error) {
    throw new ConfigError(`The server config's provider can't start: ${(error as Error).message}`);
  }

  const usesJudge = fixtures.some((job) => job.tests.some((test) => test.turns.some((turn) => turn.expect?.some((a) => assertionName(a).name === 'judge'))));
  const judge = usesJudge
    ? await resolveJudge({
        ...(cli.judge ? { configured: cli.judge } : {}),
        ...(values['judge-model'] ? { flag: values['judge-model'] } : {}),
        botProvider: isAIProvider(server.provider) ? server.provider.name : server.provider.type,
        env: io.env ?? process.env,
        mode,
        ...(cli.prices ? { prices: cli.prices } : {}),
      })
    : undefined;
  if (judge) io.stderr.write(`Judge: ${judge.id}\n`);

  if (maxCost !== undefined && mode !== 'replay') {
    const unpriced = [bot.model, ...(judge ? [judge.model] : [])].filter((model) => !model || !cli.prices?.[model]);
    if (unpriced.length) {
      throw new ConfigError(
        `--max-cost needs a price for every model the run uses, and there's none for ${unpriced.map((m) => m ?? 'a provider with no model id').join(', ')}. Add them to \`prices\` in the config, in US dollars per million tokens.`
      );
    }
  }
  const spend = new Spend(maxCost, mode !== 'replay');

  if (cassettes) {
    await cassettes.load(fixtures.map((job) => job.path ?? job.file));
    if (cassettes.mode === 'replay') io.stderr.write(`Replaying recorded API calls${values.replay ? '' : ' (CI is set)'}. Run with --record to update them.\n`);
    if (cassettes.mode === 'record') io.stderr.write('Recording API calls.\n');
  }

  const results = await runFixtures(server, fixtures, {
    ...(cassettes ? { cassettes } : {}),
    ...(judge ? { judge } : {}),
    ...(bot.model ? { model: bot.model } : {}),
    ...(cli.prices ? { prices: cli.prices } : {}),
    spend,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(repeat !== undefined ? { repeat } : {}),
    onResult: (result) => {
      for (const reporter of reporters) reporter.onResult?.(result);
    },
  });
  const costs = results.flatMap((r) => r.runs.flatMap((run) => run.turns.flatMap(({ turn, results: checks }) => [turn.costUsd, ...checks.map((c) => c.costUsd)])));
  const priced = costs.filter((cost): cost is number => cost !== undefined);
  const summary = { mode, ...(judge ? { judge: judge.id } : {}), ...(priced.length ? { costUsd: priced.reduce((a, b) => a + b, 0) } : {}) };
  for (const reporter of reporters) await reporter.onEnd?.(results, summary);
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

function positiveNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0) throw new ConfigError(`${flag} takes an amount in US dollars, such as 0.50, not "${value}".`);
  return Number(value);
}
