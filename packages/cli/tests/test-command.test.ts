import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, main } from '../src/index.js';
import { check, unknownAssertions } from '../src/test/assertions/index.js';
import { matchesFilter } from '../src/test/load.js';
import { pretty } from '../src/test/reporters/pretty.js';
import type { TurnResult } from '../src/test/types.js';

const TMP = resolve(__dirname, '.tmp-test');

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

/**
 * A fake bot that answers from the last user message, so tests can run in
 * any order and at once: prices, an order lookup through a tool, a count of
 * the conversation so far, a provider failure, and a reply that alternates.
 */
const CONFIG = `import { textStep, toolStep } from '@chatcops/core/testing/provider';
let flips = 0;
const bot = {
  name: 'fake',
  model: 'fake-1',
  async *step({ messages }) {
    const last = messages[messages.length - 1];
    const toolResult = last.role === 'assistant' ? last.parts?.find((p) => p.type === 'tool-result') : undefined;
    const user = [...messages].reverse().find((m) => m.role === 'user').content;
    let events;
    if (toolResult) events = textStep('Order ' + JSON.stringify(toolResult.output));
    else if (/order/i.test(user)) events = toolStep([{ name: 'lookup_order', input: { id: 'A-1' } }]);
    else if (/price/i.test(user)) events = textStep('The Team plan is $19 a month.');
    else if (/how many/i.test(user)) events = textStep('You sent ' + messages.filter((m) => m.role === 'user').length + ' messages.');
    else if (/boom/i.test(user)) throw new Error('model down');
    else if (/flip/i.test(user)) events = textStep(flips++ % 2 ? 'tails' : 'heads');
    else if (/which page/i.test(user)) events = textStep('You asked: ' + user);
    else events = textStep('Hello!');
    for (const event of events) yield event;
  },
};
export default {
  server: {
    provider: bot,
    systemPrompt: 'You are a test bot.',
    tools: [
      {
        name: 'lookup_order',
        description: 'Looks up an order',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        async execute() { return { success: true, data: { status: 'real' } }; },
      },
    ],
  },
};
`;

function project(files: Record<string, string>, config = CONFIG): string {
  const dir = mkdtempSync(join(TMP, 'evals-'));
  writeFileSync(join(dir, 'chatcops.config.mjs'), config);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

async function run(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  // An empty env, so CI=true on the CI machine doesn't switch these runs to replay.
  const code = await main(args, { stdout: { write: (t: string) => (stdout += t) }, stderr: { write: (t: string) => (stderr += t) }, cwd, env: {} });
  return { code, stdout, stderr };
}

const PRICING = `version: 1
name: Pricing
tests:
  - name: quotes the team price
    tags: [pricing]
    turns:
      - user: What's the price of Team?
        expect:
          - contains: "$19"
          - not-contains: "$29"
  - name: says hello
    turns:
      - user: hi
        expect:
          - contains: [Hello]
`;

describe('chatcops test', () => {
  it('runs every eval file and exits 0 when all pass', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    const { code, stdout } = await run(['test'], dir);
    expect(code).toBe(EXIT.ok);
    expect(stdout).toContain('✓ evals/pricing.chat.yaml > quotes the team price');
    expect(stdout).toContain('✓ evals/pricing.chat.yaml > says hello');
    expect(stdout).toContain('2 passed, 0 failed.');
  });

  it('exits 1 on a failed assertion and says why, with the reply', async () => {
    const dir = project({
      'evals/pricing.chat.yaml': `version: 1
name: Pricing
tests:
  - name: wrong price
    turns:
      - user: price?
        expect:
          - contains: "$29"
          - not-contains: "$19"
`,
    });
    const { code, stdout } = await run(['test'], dir);
    expect(code).toBe(EXIT.problems);
    expect(stdout).toContain('✗ evals/pricing.chat.yaml > wrong price');
    expect(stdout).toContain(`turn 1: the reply doesn't contain "$29"`);
    expect(stdout).toContain('turn 1: expected not: the reply contains "$19"');
    expect(stdout).toContain('reply: The Team plan is $19 a month.');
    expect(stdout).toContain('0 passed, 1 failed.');
  });

  it('keeps the conversation across turns and sends page context', async () => {
    const dir = project({
      'evals/flow.chat.yaml': `version: 1
name: Flow
defaults:
  pageContext: { url: "https://example.com/pricing", title: "Pricing page" }
tests:
  - name: three turns
    turns:
      - user: hi
      - user: hello again
      - user: how many did I send?
        expect: [{ contains: "You sent 3 messages." }]
  - name: page
    turns:
      - user: which page?
        expect: [{ contains: "Pricing page" }]
`,
    });
    const { code, stdout } = await run(['test'], dir);
    expect(stdout).toContain('2 passed');
    expect(code).toBe(EXIT.ok);
  });

  it('answers tools from mocks, and the defaults merge with the test', async () => {
    const files = {
      'evals/orders.chat.yaml': `version: 1
name: Orders
defaults:
  mocks:
    tools:
      lookup_order: { success: true, data: { status: "shipped" } }
tests:
  - name: mocked
    turns:
      - user: where is my order?
        expect: [{ contains: shipped }]
  - name: overridden
    mocks:
      tools:
        lookup_order: { success: true, data: { status: "lost" } }
    turns:
      - user: where is my order?
        expect: [{ contains: lost }]
`,
    };
    const { code, stdout } = await run(['test', '--json'], project(files));
    expect(code).toBe(EXIT.ok);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ passed: 2, failed: 0 });
    const turn = report.results[0].runs[0].turns[0].turn;
    expect(turn.toolCalls).toEqual([{ name: 'lookup_order', input: { id: 'A-1' } }]);
    expect(turn.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(turn.finishReason).toBe('stop');
  });

  it('fails a test whose turn errors, and stops that run', async () => {
    const dir = project({
      'evals/down.chat.yaml': `version: 1
name: Down
tests:
  - name: provider fails
    turns:
      - user: boom
      - user: price?
`,
    });
    const { code, stdout } = await run(['test', '--json'], dir);
    expect(code).toBe(EXIT.problems);
    const run1 = JSON.parse(stdout).results[0].runs[0];
    expect(run1.turns).toHaveLength(1);
    expect(run1.error).toMatch(/^turn 1 failed: /);
  });

  it('repeats tests and passes on the pass rate', async () => {
    const fixture = (passRate: number) => `version: 1
name: Coin
tests:
  - name: flips
    repeat: 4
    passRate: ${passRate}
    turns:
      - user: flip
        expect: [{ contains: heads }]
`;
    const half = await run(['test'], project({ 'evals/coin.chat.yaml': fixture(0.5) }));
    expect(half.code).toBe(EXIT.ok);
    expect(half.stdout).toContain('(2/4 runs)');
    const all = await run(['test'], project({ 'evals/coin.chat.yaml': fixture(1) }));
    expect(all.code).toBe(EXIT.problems);
    // --repeat overrides the file.
    const once = await run(['test', '--repeat', '1', '--json'], project({ 'evals/coin.chat.yaml': fixture(1) }));
    expect(JSON.parse(once.stdout).results[0].runs).toHaveLength(1);
  });

  it('picks files by glob and tests by --filter', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING, 'other/extra.chat.yaml': PRICING.replace('name: Pricing', 'name: Extra') });
    const byTag = await run(['test', '--filter', 'tag:pricing'], dir);
    expect(byTag.stdout).toContain('1 passed, 0 failed.');
    const byName = await run(['test', '--filter', 'HELLO'], dir);
    expect(byName.stdout).toContain('says hello');
    expect(byName.stdout).not.toContain('team price');
    const both = await run(['test', 'evals/**/*.chat.yaml', 'other/*.chat.yaml'], dir);
    expect(both.stdout).toContain('4 passed');
    expect((await run(['test', '--filter', 'nothing'], dir)).code).toBe(EXIT.unusable);
  });

  it('reports with each --reporter given', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    const json = await run(['test', '--reporter', 'json'], dir);
    expect(JSON.parse(json.stdout)).toMatchObject({ passed: 2, failed: 0 });
    const both = await run(['test', '--reporter', 'pretty', '--reporter', 'json'], dir);
    expect(both.stdout).toContain('✓ evals/pricing.chat.yaml > says hello');
    expect(JSON.parse(both.stdout.trim().split('\n').at(-1) ?? '')).toMatchObject({ passed: 2 });
    const unknown = await run(['test', '--reporter', 'html'], dir);
    expect(unknown.stderr).toContain("--reporter html doesn't exist. Use one of: pretty, json.");
    expect(unknown.code).toBe(EXIT.unusable);
    expect((await run(['test', '--json', '--reporter', 'json'], dir)).stderr).toContain('not both');
  });

  it('loads module eval files', async () => {
    const dir = project({
      'evals/pricing.chat.mjs': `export default { version: 1, name: 'Module', tests: [{ name: 'js', turns: [{ user: 'price', expect: [{ contains: '$19' }] }] }] };`,
    });
    const { code, stdout } = await run(['test', 'evals/*.chat.mjs'], dir);
    expect(stdout).toContain('✓ evals/pricing.chat.mjs > js');
    expect(code).toBe(EXIT.ok);
  });

  it('exits 2 before running anything when the files or config are wrong', async () => {
    const cases: Array<[Record<string, string>, RegExp, string?]> = [
      [{}, /No eval files match evals\/\*\*\/\*\.chat\.yaml/],
      [{ 'evals/a.chat.yaml': 'version: 2\nname: x\ntests: []' }, /isn't a valid eval file:\n {2}version: .*\n {2}tests: /],
      [{ 'evals/a.chat.yaml': 'version: 1\nname: x\nextra: 1\ntests: [{ name: t, turns: [{ user: hi }] }]' }, /Unrecognized key\(s\) in object: 'extra'/],
      [{ 'evals/a.chat.yaml': 'version: 1\nname: x\ntests: [{ name: t, turns: [{ user: hi, expect: [{ contains: a, icontains: b }] }] }]' }, /exactly one key/],
      [{ 'evals/a.chat.yaml': 'version: 1\nname: x\ntests: [{ name: t, turns: [{ user: hi, expect: [{ smells-nice: true }, { not-smells-nice: 1 }] }] }]' }, /uses assertions that don't exist: smells-nice, not-smells-nice/],
      [{ 'evals/a.chat.yaml': 'version: 1\nname: x\ntests: [{ name: t, mocks: { tools: { refund: { success: true } } }, turns: [{ user: hi }] }]' }, /a\.chat\.yaml > t: Mocks for tools the server config doesn't have: refund/],
      [{ 'evals/a.chat.yaml': 'version: 1\nname: x\ntests: [{ name: t, turns: [{ user: hi }] }]' }, /needs a `server` config for chatcops test/, 'export default {};'],
      [{ 'evals/a.chat.yaml': ': : :' }, /a\.chat\.yaml: /],
    ];
    for (const [files, error, config] of cases) {
      const { code, stderr } = await run(['test'], project(files, config));
      expect(stderr).toMatch(error);
      expect(code).toBe(EXIT.unusable);
    }
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    expect((await run(['test', '--repeat', '0'], dir)).code).toBe(EXIT.unusable);
    expect((await run(['test', '--concurrency', 'lots'], dir)).stderr).toContain('--concurrency takes a whole number');
  });

  it("doesn't need an embedder for test, or a server for ingest", async () => {
    const dir = project({}, 'export default { server: { provider: { name: "x", async *step() {} }, systemPrompt: "x" } };');
    expect((await run(['search', 'refunds'], dir)).stderr).toContain('needs an `embedder`');
  });
});

describe('assertions', () => {
  const turn: TurnResult = { user: 'q', text: 'The Team plan is $19.', toolCalls: [], sources: [], leads: [], latencyMs: 1 };

  it('contains takes a string or a list, and not- inverts it', async () => {
    expect(await check({ contains: ['Team', '$19'] }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ contains: ['Team', 'Pro'] }, turn, [turn])).toMatchObject({ pass: false, reason: `the reply doesn't contain "Pro"` });
    expect(await check({ 'not-contains': 'Pro' }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ 'not-contains': 'Team' }, turn, [turn])).toMatchObject({ pass: false, reason: 'expected not: the reply contains "Team"' });
  });

  it('reports bad values and unknown names as failures', async () => {
    expect(await check({ contains: 19 }, turn, [turn])).toMatchObject({ pass: false, reason: 'contains takes a string or a list of strings' });
    expect(await check({ contains: [] }, turn, [turn])).toMatchObject({ pass: false });
    expect(await check({ nope: 1 }, turn, [turn])).toMatchObject({ pass: false, reason: 'unknown assertion "nope"' });
    expect(unknownAssertions([{ contains: 'a' }, { 'not-contains': 'b' }, { 'not-nope': 1 }, { 'not-nope': 2 }])).toEqual(['not-nope']);
  });

  it('filters by tag or by name', () => {
    const test = { name: 'Quotes Price', tags: ['pricing'], turns: [{ user: 'x' }] };
    expect(matchesFilter(test, undefined)).toBe(true);
    expect(matchesFilter(test, 'quotes')).toBe(true);
    expect(matchesFilter(test, 'tag:pricing')).toBe(true);
    expect(matchesFilter(test, 'tag:sales')).toBe(false);
    expect(matchesFilter({ ...test, tags: undefined }, 'tag:pricing')).toBe(false);
  });

  it('prints a failed run with no turns', () => {
    const out = pretty({ fixture: 'a.yaml', test: 't', passRate: 0, pass: false, runs: [{ fixture: 'a.yaml', test: 't', run: 1, pass: false, turns: [], error: 'turn 1 failed: x' }] });
    expect(out).toBe('✗ a.yaml > t\n    turn 1 failed: x\n');
  });
});
