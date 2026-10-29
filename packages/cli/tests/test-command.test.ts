import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, main } from '../src/index.js';
import { check, unknownAssertions } from '../src/test/assertions/index.js';
import { matchesFilter } from '../src/test/load.js';
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

async function run(args: string[], cwd: string, env: Record<string, string | undefined> = {}, isTTY = false) {
  let stdout = '';
  let stderr = '';
  const stdoutStream = { write: (text: string) => (stdout += text), isTTY };
  // An empty env, so CI=true on the CI machine doesn't switch these runs to replay.
  const code = await main(args, { stdout: stdoutStream, stderr: { write: (text: string) => (stderr += text) }, cwd, env });
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
    expect(stdout).toContain(`${join('evals', 'pricing.chat.yaml')}\n  ✓ quotes the team price`);
    expect(stdout).toContain('  ✓ says hello');
    expect(stdout).toContain('2 passed, 0 failed.');
  });

  it('runs an eval file exercising icontains, regex, and equals assertions', async () => {
    const files = {
      'evals/text-assertions.chat.yaml': `version: 1
name: Text Assertions
tests:
  - name: checks icontains, regex, and equals
    turns:
      - user: What's the price of Team?
        expect:
          - icontains: team
          - icontains: ["$19", MONTH]
          - not-icontains: pro
          - regex: '\\$\\d+'
          - regex: { pattern: "team plan", flags: "i" }
          - not-regex: "^Pro"
          - equals: "The Team plan is $19 a month."
          - not-equals: "The Pro plan is $29 a month."
`,
    };
    const { code, stdout, stderr } = await run(['test'], project(files));
    expect(stderr).toBe('');
    expect(code).toBe(EXIT.ok);
    expect(stdout).toContain(`${join('evals', 'text-assertions.chat.yaml')}\n  ✓ checks icontains, regex, and equals`);
    expect(stdout).toContain('1 passed, 0 failed.');
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
    expect(stdout).toContain(`${join('evals', 'pricing.chat.yaml')}\n  ✗ wrong price`);
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

  it('verifies tool calls with calls-tool and no-tool-call', async () => {
    const files = {
      'evals/tools.chat.yaml': `version: 1
name: Tool Calls
defaults:
  mocks:
    tools:
      lookup_order: { success: true, data: { status: "shipped" } }
tests:
  - name: asserts tool call and arguments
    turns:
      - user: where is my order?
        expect:
          - calls-tool: lookup_order
          - calls-tool: { name: lookup_order, args: { id: "A-1" } }
          - no-tool-call: other_tool
          - contains: shipped
  - name: asserts no tool was called
    turns:
      - user: hi
        expect:
          - no-tool-call: true
          - not-calls-tool: lookup_order
          - contains: Hello
`,
    };
    const { code, stdout } = await run(['test', '--json'], project(files));
    expect(code).toBe(EXIT.ok);
    const report = JSON.parse(stdout);
    expect(report).toMatchObject({ passed: 2, failed: 0 });
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

  it('fails a test whose knowledge source throws, and keeps running the others', async () => {
    const failing = CONFIG.replace(
      "  server: {\n    provider: bot,",
      "  server: {\n    knowledge: [{ type: 'broken', async getContext(q) { if (/broken/.test(q)) throw new Error('index unreachable'); return ''; } }],\n    provider: bot,"
    );
    const dir = project(
      {
        'evals/mixed.chat.yaml': `version: 1
name: Mixed
tests:
  - name: broken knowledge
    turns:
      - user: broken please
  - name: still runs
    turns:
      - user: price?
        expect: [{ contains: "$19" }]
`,
      },
      failing
    );
    const { code, stdout } = await run(['test', '--json'], dir);
    const results = JSON.parse(stdout).results;
    expect(code).toBe(EXIT.problems);
    expect(results[0].runs[0].error).toBe('turn 1 failed: internal_error: index unreachable');
    expect(results[1].pass).toBe(true);
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
    expect(both.stdout).toContain('  ✓ says hello');
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
    expect(stdout).toContain(`${join('evals', 'pricing.chat.mjs')}\n  ✓ js`);
    expect(code).toBe(EXIT.ok);
  });

  it('shows passing assertions with --verbose and documents the option in help', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    const normal = await run(['test'], dir);
    expect(normal.stdout).not.toContain('turn 1: the reply contains "$19"');
    const verbose = await run(['test', '--verbose'], dir);
    expect(verbose.code).toBe(EXIT.ok);
    expect(verbose.stdout).toContain('✓ turn 1: the reply contains "$19"');
    expect((await run(['--help'], dir)).stdout).toContain('--verbose');
  });

  it('checks cites and lead-captured against real source and lead parts', async () => {
    const config = `import { textStep, toolStep } from '@chatcops/core/testing/provider';
import { LeadCaptureTool } from '@chatcops/core';
const page = { id: 'https://acme.test/pricing', url: 'https://acme.test/pricing', title: 'Pricing' };
const knowledge = { type: 'test', async retrieve() { return [{ id: 'p', text: 'Team is $19.', score: 1, source: page }]; }, async getContext() { return ''; } };
const bot = {
  name: 'fake',
  model: 'fake-1',
  citations: 'native',
  async *step({ messages }) {
    const last = messages[messages.length - 1];
    const user = [...messages].reverse().find((m) => m.role === 'user').content;
    let events;
    if (last.role === 'assistant' && last.parts?.some((p) => p.type === 'tool-result')) events = textStep('Thanks, we will be in touch.');
    else if (/@/.test(user)) events = toolStep([{ name: 'capture_lead', input: { name: 'Jane', email: 'jane@acme.test', projectDetails: 'A help bot' } }]);
    else events = [{ type: 'text-delta', delta: 'Team is $19.' }, { type: 'source', index: 0 }, { type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1 }, parts: [{ type: 'text', text: 'Team is $19.' }] }];
    for (const event of events) yield event;
  },
};
export default { server: { provider: bot, systemPrompt: 'You are a test bot.', knowledge: [knowledge], tools: [new LeadCaptureTool()] } };
`;
    const evals = `version: 1
name: Parts
tests:
  - name: cites the pricing page
    turns:
      - user: what's the price?
        expect:
          - cites: "https://acme.test/pricing"
          - cites: true
          - not-cites: "https://acme.test/blog/**"
          - not-lead-captured: true
  - name: captures the lead
    turns:
      - user: I'm Jane, jane@acme.test
        expect:
          - lead-captured: true
          - lead-captured: { email: jane@acme.test }
          - not-cites: true
`;
    const { code, stdout } = await run(['test', '--json'], project({ 'evals/parts.chat.yaml': evals }, config));
    const results = JSON.parse(stdout).results.flatMap((r: { runs: Array<{ turns: Array<{ results: Array<{ pass: boolean; reason: string }> }> }> }) => r.runs[0].turns[0].results);
    expect(results.map((r: { reason: string }) => r.reason)).toEqual([
      'the reply cites "https://acme.test/pricing"',
      'the reply cites "https://acme.test/pricing"',
      'the reply doesn\'t cite "https://acme.test/blog/**" (it cites "https://acme.test/pricing")',
      'the turn captured no lead',
      'the turn captured a lead',
      'the turn captured a lead with email "jane@acme.test"',
      'the reply cites no pages',
    ]);
    expect(results.every((r: { pass: boolean }) => r.pass)).toBe(true);
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

  it('icontains matches case-insensitively, and not- inverts it', async () => {
    expect(await check({ icontains: ['team', '$19'] }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ icontains: 'TEAM' }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ icontains: ['team', 'pro'] }, turn, [turn])).toMatchObject({ pass: false, reason: 'the reply doesn\'t contain "pro"' });
    expect(await check({ 'not-icontains': 'pro' }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ 'not-icontains': 'team' }, turn, [turn])).toMatchObject({ pass: false, reason: 'expected not: the reply contains "team"' });
    expect(await check({ icontains: 19 }, turn, [turn])).toMatchObject({ pass: false, reason: 'icontains takes a string or a list of strings' });
    expect(await check({ icontains: [] }, turn, [turn])).toMatchObject({ pass: false, reason: 'icontains takes a string or a list of strings' });
    expect(await check({ 'not-icontains': 19 }, turn, [turn])).toMatchObject({ pass: false, reason: 'icontains takes a string or a list of strings' });
  });

  it('regex matches the reply with a pattern or { pattern, flags }, and not- inverts it', async () => {
    expect(await check({ regex: '\\$\\d+' }, turn, [turn])).toMatchObject({ pass: true, reason: 'the reply matches /\\$\\d+/' });
    expect(await check({ regex: { pattern: 'team', flags: 'i' } }, turn, [turn])).toMatchObject({ pass: true, reason: 'the reply matches /team/i' });
    expect(await check({ regex: { pattern: '\\$\\d+' } }, turn, [turn])).toMatchObject({ pass: true, reason: 'the reply matches /\\$\\d+/' });
    expect(await check({ regex: 'pro' }, turn, [turn])).toMatchObject({ pass: false, reason: "the reply doesn't match /pro/" });
    expect(await check({ regex: { pattern: '^team' } }, turn, [turn])).toMatchObject({ pass: false, reason: "the reply doesn't match /^team/" });
    expect(await check({ 'not-regex': 'pro' }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ 'not-regex': '\\$\\d+' }, turn, [turn])).toMatchObject({ pass: false, reason: 'expected not: the reply matches /\\$\\d+/' });
    expect(await check({ 'not-regex': { pattern: 'team', flags: 'i' } }, turn, [turn])).toMatchObject({ pass: false, reason: 'expected not: the reply matches /team/i' });

    expect(await check({ regex: '(' }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'regex: "(" isn\'t a valid regular expression (Unterminated group)',
    });
    expect(await check({ 'not-regex': '(' }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'regex: "(" isn\'t a valid regular expression (Unterminated group)',
    });
    expect(await check({ regex: { pattern: '(' } }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'regex: "(" isn\'t a valid regular expression (Unterminated group)',
    });
    expect(await check({ regex: { pattern: 'a', flags: 'zz' } }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'regex: flags "zz" aren\'t valid regular expression flags',
    });
    expect(await check({ 'not-regex': { pattern: 'a', flags: 'zz' } }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'regex: flags "zz" aren\'t valid regular expression flags',
    });
    expect(await check({ regex: '[' }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'regex: "[" isn\'t a valid regular expression (Unterminated character class)',
    });
    expect(await check({ regex: { pattern: '[' } }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'regex: "[" isn\'t a valid regular expression (Unterminated character class)',
    });
    expect(await check({ regex: { pattern: 'team', flags: 'invalid' } }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'regex: flags "invalid" aren\'t valid regular expression flags',
    });
    expect(await check({ regex: { pattern: 'team', flags: 123 } }, turn, [turn])).toMatchObject({ pass: false, reason: 'regex flags must be a string' });
    for (const bad of [19, null, [], {}, { pattern: 19 }, { pattern: 'team', extra: 1 }]) {
      expect(await check({ regex: bad }, turn, [turn])).toMatchObject({ pass: false, reason: 'regex takes a pattern string or { pattern, flags }' });
      expect(await check({ 'not-regex': bad }, turn, [turn])).toMatchObject({ pass: false, reason: 'regex takes a pattern string or { pattern, flags }' });
    }
  });

  it('equals compares the trimmed reply with the expected string, and not- inverts it', async () => {
    expect(await check({ equals: 'The Team plan is $19.' }, turn, [turn])).toMatchObject({ pass: true, reason: 'the reply equals "The Team plan is $19."' });
    const padded: TurnResult = { ...turn, text: '  The Team plan is $19. \n' };
    expect(await check({ equals: 'The Team plan is $19.' }, padded, [padded])).toMatchObject({ pass: true });
    expect(await check({ equals: 'The Team plan is $19.\n' }, turn, [turn])).toMatchObject({ pass: true, reason: 'the reply equals "The Team plan is $19.\\n"' });
    expect(await check({ equals: 'The Team plan is $19.\n' }, padded, [padded])).toMatchObject({ pass: true });
    expect(await check({ equals: 'The Pro plan is $29.' }, turn, [turn])).toMatchObject({ pass: false, reason: 'the reply doesn\'t equal "The Pro plan is $29."' });
    expect(await check({ equals: 'The Pro plan is $29.\n' }, turn, [turn])).toMatchObject({ pass: false, reason: 'the reply doesn\'t equal "The Pro plan is $29.\\n"' });
    expect(await check({ 'not-equals': 'The Pro plan is $29.' }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ 'not-equals': 'The Pro plan is $29.\n' }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ 'not-equals': 'The Team plan is $19.' }, turn, [turn])).toMatchObject({ pass: false, reason: 'expected not: the reply equals "The Team plan is $19."' });
    expect(await check({ 'not-equals': 'The Team plan is $19.\n' }, turn, [turn])).toMatchObject({ pass: false, reason: 'expected not: the reply equals "The Team plan is $19.\\n"' });
    for (const bad of [19, null, [], {}, true]) {
      expect(await check({ equals: bad }, turn, [turn])).toMatchObject({ pass: false, reason: 'equals takes a string' });
      expect(await check({ 'not-equals': bad }, turn, [turn])).toMatchObject({ pass: false, reason: 'equals takes a string' });
    }
  });

  it('reports bad values and unknown names as failures', async () => {
    expect(await check({ contains: 19 }, turn, [turn])).toMatchObject({ pass: false, reason: 'contains takes a string or a list of strings' });
    expect(await check({ contains: [] }, turn, [turn])).toMatchObject({ pass: false });
    expect(await check({ nope: 1 }, turn, [turn])).toMatchObject({ pass: false, reason: 'unknown assertion "nope"' });
    expect(unknownAssertions([{ contains: 'a' }, { 'not-contains': 'b' }, { 'not-nope': 1 }, { 'not-nope': 2 }])).toEqual(['not-nope']);
  });

  it('tokens-under checks the total, or input and output separately', async () => {
    const used: TurnResult = { ...turn, usage: { inputTokens: 600, outputTokens: 150 } };
    expect(await check({ 'tokens-under': 800 }, used, [used])).toMatchObject({ pass: true, reason: 'the turn used 750 tokens (limit 800)' });
    expect(await check({ 'tokens-under': 700 }, used, [used])).toMatchObject({ pass: false, reason: 'the turn used 750 tokens, over the 700 limit' });
    expect(await check({ 'tokens-under': { input: 700, output: 200 } }, used, [used])).toMatchObject({ pass: true });
    expect(await check({ 'tokens-under': { input: 500, output: 200 } }, used, [used])).toMatchObject({ pass: false, reason: 'the turn used 600 input tokens, over the 500 limit' });
    expect(await check({ 'tokens-under': { input: 700 } }, used, [used])).toMatchObject({ pass: true, reason: 'the turn used 600 input tokens (limit 700)' });
    expect(await check({ 'tokens-under': { output: 100 } }, used, [used])).toMatchObject({ pass: false, reason: 'the turn used 150 output tokens, over the 100 limit' });
    expect(await check({ 'not-tokens-under': 700 }, used, [used])).toMatchObject({ pass: true });
    expect(await check({ 'tokens-under': 800 }, turn, [turn])).toMatchObject({ pass: false, reason: 'the turn has no token usage to check' });
    expect(await check({ 'not-tokens-under': 800 }, turn, [turn])).toMatchObject({ pass: false, reason: 'the turn has no token usage to check' });
    expect(await check({ 'tokens-under': 750 }, used, [used])).toMatchObject({ pass: false, reason: 'the turn used 750 tokens, over the 750 limit' });
  });

  it('latency-under and cost-under compare the turn with a limit', async () => {
    const priced: TurnResult = { ...turn, usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 1234.567891, costUsd: 0.0123456789, model: 'acme-small' };
    expect(await check({ 'latency-under': 3000 }, priced, [priced])).toMatchObject({ pass: true, reason: 'the reply took 1235 ms (limit 3000 ms)' });
    expect(await check({ 'latency-under': 1000 }, priced, [priced])).toMatchObject({ pass: false, reason: 'the reply took 1235 ms, over the 1000 ms limit' });
    expect(await check({ 'cost-under': 0.05 }, priced, [priced])).toMatchObject({ pass: true, reason: 'the turn cost $0.0123 (limit $0.0500)' });
    expect(await check({ 'cost-under': 0.01 }, priced, [priced])).toMatchObject({ pass: false, reason: 'the turn cost $0.0123, over the $0.0100 limit' });
    expect(await check({ 'latency-under': 1234.567891 }, priced, [priced])).toMatchObject({ pass: false });
    expect(await check({ 'cost-under': 0.0123456789 }, priced, [priced])).toMatchObject({ pass: false });
    const noUsage: TurnResult = { ...priced, usage: undefined, costUsd: undefined };
    expect(await check({ 'cost-under': 0.01 }, noUsage, [noUsage])).toMatchObject({ pass: false, reason: 'the turn has no token usage to check' });
    const unpriced: TurnResult = { ...priced, costUsd: undefined };
    expect(await check({ 'cost-under': 0.01 }, unpriced, [unpriced])).toMatchObject({
      pass: false,
      reason: 'the turn has no cost: add "acme-small" to `prices` in the config',
    });
    const nameless: TurnResult = { ...unpriced, model: undefined };
    expect(await check({ 'cost-under': 0.01 }, nameless, [nameless])).toMatchObject({ reason: 'the turn has no cost: add the model to `prices` in the config' });
    expect(await check({ 'not-cost-under': 0.01 }, unpriced, [unpriced])).toMatchObject({ pass: false, reason: 'the turn has no cost: add "acme-small" to `prices` in the config' });
  });

  it('usage assertions reject values that are not limits', async () => {
    for (const value of ['800', -1, Number.NaN, [800]]) {
      expect(await check({ 'tokens-under': value }, turn, [turn])).toMatchObject({ pass: false, reason: expect.stringMatching(/^tokens-under takes a number/) });
      expect(await check({ 'latency-under': value }, turn, [turn])).toMatchObject({ pass: false, reason: 'latency-under takes a number of 0 or more' });
      expect(await check({ 'cost-under': value }, turn, [turn])).toMatchObject({ pass: false, reason: 'cost-under takes a number of 0 or more' });
    }
    expect(await check({ 'tokens-under': { total: 800 } }, turn, [turn])).toMatchObject({ pass: false, reason: 'tokens-under takes a number, or { input, output }' });
    expect(await check({ 'tokens-under': {} }, turn, [turn])).toMatchObject({ pass: false, reason: 'tokens-under takes a number, or { input, output }' });
  });

  it('cites matches each glob against the cited pages, and cites: true needs one', async () => {
    const cited: TurnResult = { ...turn, sources: [{ url: 'https://acme.test/pricing' }, { url: 'https://acme.test/docs/plans/team' }] };
    expect(await check({ cites: 'https://acme.test/pricing' }, cited, [cited])).toMatchObject({ pass: true, reason: 'the reply cites "https://acme.test/pricing"' });
    expect(await check({ cites: ['https://acme.test/pricing', 'https://acme.test/docs/**'] }, cited, [cited])).toMatchObject({ pass: true });
    expect(await check({ cites: ['https://acme.test/pricing', 'https://acme.test/blog/*'] }, cited, [cited])).toMatchObject({
      pass: false,
      reason: `the reply doesn't cite "https://acme.test/blog/*" (it cites "https://acme.test/pricing", "https://acme.test/docs/plans/team")`,
    });
    expect(await check({ cites: true }, cited, [cited])).toMatchObject({ pass: true });
    expect(await check({ cites: true }, turn, [turn])).toMatchObject({ pass: false, reason: 'the reply cites no pages' });
    expect(await check({ cites: 'https://acme.test/*' }, turn, [turn])).toMatchObject({ pass: false, reason: `the reply doesn't cite "https://acme.test/*" (it cites no pages)` });
    expect(await check({ 'not-cites': true }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ 'not-cites': 'https://acme.test/blog/*' }, cited, [cited])).toMatchObject({ pass: true });
    expect(await check({ 'not-cites': 'https://acme.test/pricing' }, cited, [cited])).toMatchObject({ pass: false });
    for (const value of [false, 3, [], [true]]) {
      expect(await check({ cites: value }, cited, [cited])).toMatchObject({ pass: false, reason: 'cites takes true, a URL glob or a list of them' });
    }
  });

  it('lead-captured checks for a lead, or one with the given fields', async () => {
    const lead: TurnResult = { ...turn, leads: [{ name: 'Jane', email: 'jane@acme.test' }] };
    expect(await check({ 'lead-captured': true }, lead, [lead])).toMatchObject({ pass: true, reason: 'the turn captured a lead' });
    expect(await check({ 'lead-captured': { email: 'jane@acme.test' } }, lead, [lead])).toMatchObject({ pass: true, reason: 'the turn captured a lead with email "jane@acme.test"' });
    expect(await check({ 'lead-captured': { email: 'jane@acme.test', name: 'Joe' } }, lead, [lead])).toMatchObject({
      pass: false,
      reason: 'no lead the turn captured has email "jane@acme.test", name "Joe"',
    });
    expect(await check({ 'lead-captured': true }, turn, [turn])).toMatchObject({ pass: false, reason: 'the turn captured no lead' });
    expect(await check({ 'not-lead-captured': true }, turn, [turn])).toMatchObject({ pass: true });
    expect(await check({ 'not-lead-captured': { name: 'Joe' } }, lead, [lead])).toMatchObject({ pass: true });
    for (const value of [false, 'jane@acme.test', {}, [], null]) {
      expect(await check({ 'lead-captured': value }, lead, [lead])).toMatchObject({ pass: false, reason: 'lead-captured takes true, or the fields the lead should have' });
    }
  });

  it('calls-tool matches by name, partial args, nested args, and arrays exactly', async () => {
    const withCall: TurnResult = {
      ...turn,
      toolCalls: [
        {
          name: 'lookup_order',
          input: {
            id: 'A-1',
            status: 'open',
            details: { priority: 'high', tags: ['urgent', 'billing'] },
            meta: { extra: true },
          },
        },
      ],
    };

    // Name-only matching (string or object)
    expect(await check({ 'calls-tool': 'lookup_order' }, withCall, [withCall])).toMatchObject({
      pass: true,
      reason: 'the turn called "lookup_order"',
    });
    expect(await check({ 'calls-tool': { name: 'lookup_order' } }, withCall, [withCall])).toMatchObject({
      pass: true,
      reason: 'the turn called "lookup_order"',
    });
    expect(await check({ 'calls-tool': 'cancel_order' }, withCall, [withCall])).toMatchObject({
      pass: false,
    });

    // Partial arguments
    expect(await check({ 'calls-tool': { name: 'lookup_order', args: { id: 'A-1' } } }, withCall, [withCall])).toMatchObject({
      pass: true,
      reason: 'the turn called "lookup_order" with {"id":"A-1"}',
    });
    expect(await check({ 'calls-tool': { name: 'lookup_order', args: { id: 'A-1', status: 'open' } } }, withCall, [withCall])).toMatchObject({
      pass: true,
    });
    expect(await check({ 'calls-tool': { name: 'lookup_order', args: { id: 'A-2' } } }, withCall, [withCall])).toMatchObject({
      pass: false,
    });

    // Nested arguments
    expect(
      await check(
        { 'calls-tool': { name: 'lookup_order', args: { details: { priority: 'high' } } } },
        withCall,
        [withCall],
      ),
    ).toMatchObject({ pass: true });
    expect(
      await check(
        { 'calls-tool': { name: 'lookup_order', args: { details: { priority: 'low' } } } },
        withCall,
        [withCall],
      ),
    ).toMatchObject({ pass: false });

    // Array arguments must match exactly
    expect(
      await check(
        { 'calls-tool': { name: 'lookup_order', args: { details: { tags: ['urgent', 'billing'] } } } },
        withCall,
        [withCall],
      ),
    ).toMatchObject({ pass: true });
    expect(
      await check(
        { 'calls-tool': { name: 'lookup_order', args: { details: { tags: ['urgent'] } } } },
        withCall,
        [withCall],
      ),
    ).toMatchObject({ pass: false });
    expect(
      await check(
        { 'calls-tool': { name: 'lookup_order', args: { details: { tags: ['billing', 'urgent'] } } } },
        withCall,
        [withCall],
      ),
    ).toMatchObject({ pass: false });

    // Arrays containing objects must match elements exactly, not partially
    const orderWithItems: TurnResult = {
      ...turn,
      toolCalls: [{ name: 'checkout', input: { items: [{ sku: 1, qty: 2 }] } }],
    };
    expect(
      await check(
        { 'calls-tool': { name: 'checkout', args: { items: [{ sku: 1 }] } } },
        orderWithItems,
        [orderWithItems],
      ),
    ).toMatchObject({ pass: false });
    expect(
      await check(
        { 'calls-tool': { name: 'checkout', args: { items: [{ sku: 1, qty: 2 }] } } },
        orderWithItems,
        [orderWithItems],
      ),
    ).toMatchObject({ pass: true });
  });

  it('calls-tool and no-tool-call report mismatches with actionable actual calls', async () => {
    const withCall: TurnResult = {
      ...turn,
      toolCalls: [{ name: 'lookup_order', input: { id: 'A-1' } }],
    };
    const multiCall: TurnResult = {
      ...turn,
      toolCalls: [
        { name: 'lookup_order', input: { id: 'A-1' } },
        { name: 'send_email', input: { to: 'jane@acme.test' } },
      ],
    };

    // No calls made
    expect(await check({ 'calls-tool': 'lookup_order' }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'the turn didn\'t call "lookup_order" (it called no tools)',
    });
    expect(await check({ 'calls-tool': { name: 'lookup_order', args: { id: 'A-1' } } }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'the turn didn\'t call "lookup_order" with {"id":"A-1"} (it called no tools)',
    });

    // Mismatched name or args shows actual calls
    expect(await check({ 'calls-tool': 'cancel_order' }, withCall, [withCall])).toMatchObject({
      pass: false,
      reason: 'the turn didn\'t call "cancel_order" (it called lookup_order({"id":"A-1"}))',
    });
    expect(await check({ 'calls-tool': { name: 'lookup_order', args: { id: 'A-2' } } }, withCall, [withCall])).toMatchObject({
      pass: false,
      reason: 'the turn didn\'t call "lookup_order" with {"id":"A-2"} (it called lookup_order({"id":"A-1"}))',
    });
    expect(await check({ 'calls-tool': 'cancel_order' }, multiCall, [multiCall])).toMatchObject({
      pass: false,
      reason: 'the turn didn\'t call "cancel_order" (it called lookup_order({"id":"A-1"}), send_email({"to":"jane@acme.test"}))',
    });
  });

  it('no-tool-call handles boolean true and tool name string', async () => {
    const withCall: TurnResult = {
      ...turn,
      toolCalls: [{ name: 'lookup_order', input: { id: 'A-1' } }],
    };

    // no-tool-call: true passes only when no tools called
    expect(await check({ 'no-tool-call': true }, turn, [turn])).toMatchObject({
      pass: true,
      reason: 'the turn called no tools',
    });
    expect(await check({ 'no-tool-call': true }, withCall, [withCall])).toMatchObject({
      pass: false,
      reason: 'the turn called lookup_order({"id":"A-1"})',
    });

    // no-tool-call: string passes when specific tool not called
    expect(await check({ 'no-tool-call': 'cancel_order' }, withCall, [withCall])).toMatchObject({
      pass: true,
      reason: 'the turn didn\'t call "cancel_order"',
    });
    expect(await check({ 'no-tool-call': 'lookup_order' }, withCall, [withCall])).toMatchObject({
      pass: false,
      reason: 'the turn called "lookup_order" (it called lookup_order({"id":"A-1"}))',
    });
    expect(await check({ 'no-tool-call': 'lookup_order' }, turn, [turn])).toMatchObject({
      pass: true,
      reason: 'the turn didn\'t call "lookup_order"',
    });
  });

  it('tool assertions work with negation (not- prefix)', async () => {
    const withCall: TurnResult = {
      ...turn,
      toolCalls: [{ name: 'lookup_order', input: { id: 'A-1' } }],
    };

    // not-calls-tool
    expect(await check({ 'not-calls-tool': 'lookup_order' }, turn, [turn])).toMatchObject({
      pass: true,
    });
    expect(await check({ 'not-calls-tool': 'lookup_order' }, withCall, [withCall])).toMatchObject({
      pass: false,
      reason: 'expected not: the turn called "lookup_order"',
    });
    expect(await check({ 'not-calls-tool': { name: 'lookup_order', args: { id: 'A-1' } } }, withCall, [withCall])).toMatchObject({
      pass: false,
      reason: 'expected not: the turn called "lookup_order" with {"id":"A-1"}',
    });
    expect(await check({ 'not-calls-tool': { name: 'lookup_order', args: { id: 'A-2' } } }, withCall, [withCall])).toMatchObject({
      pass: true,
    });

    // not-no-tool-call
    expect(await check({ 'not-no-tool-call': true }, withCall, [withCall])).toMatchObject({
      pass: true,
      reason: 'the turn called lookup_order({"id":"A-1"})',
    });
    expect(await check({ 'not-no-tool-call': true }, turn, [turn])).toMatchObject({
      pass: false,
      reason: 'expected not: the turn called no tools',
    });
    expect(await check({ 'not-no-tool-call': 'lookup_order' }, withCall, [withCall])).toMatchObject({
      pass: true,
    });
    expect(await check({ 'not-no-tool-call': 'cancel_order' }, withCall, [withCall])).toMatchObject({
      pass: false,
      reason: 'expected not: the turn didn\'t call "cancel_order"',
    });
  });

  it('tool assertions reject invalid values with clear errors', async () => {
    for (const value of [123, false, true, null, [], {}, { name: 123 }, { name: '' }, { args: {} }, { name: 't', args: 123 }, { name: 't', args: [] }, { name: 't', extra: 1 }]) {
      expect(await check({ 'calls-tool': value }, turn, [turn])).toMatchObject({
        pass: false,
        reason: 'calls-tool takes a tool name, or { name, args }',
      });
      // not- on invalid value still fails with the same error
      expect(await check({ 'not-calls-tool': value }, turn, [turn])).toMatchObject({
        pass: false,
        reason: 'calls-tool takes a tool name, or { name, args }',
      });
    }

    for (const value of [false, 123, null, [], {}, '']) {
      expect(await check({ 'no-tool-call': value }, turn, [turn])).toMatchObject({
        pass: false,
        reason: 'no-tool-call takes true, or a tool name',
      });
      // not- on invalid value still fails with the same error
      expect(await check({ 'not-no-tool-call': value }, turn, [turn])).toMatchObject({
        pass: false,
        reason: 'no-tool-call takes true, or a tool name',
      });
    }
  });

  it('filters by tag or by name', () => {
    const test = { name: 'Quotes Price', tags: ['pricing'], turns: [{ user: 'x' }] };
    expect(matchesFilter(test, undefined)).toBe(true);
    expect(matchesFilter(test, 'quotes')).toBe(true);
    expect(matchesFilter(test, 'tag:pricing')).toBe(true);
    expect(matchesFilter(test, 'tag:sales')).toBe(false);
    expect(matchesFilter({ ...test, tags: undefined }, 'tag:pricing')).toBe(false);
  });

  it('javascript: boolean and object returns, async, relative path', async () => {
    const fixture = join(TMP, 'js-fixture.chat.yaml');
    const checksDir = join(TMP, 'checks');
    mkdirSync(checksDir, { recursive: true });

    writeFileSync(join(checksDir, 'true.mjs'), 'export default () => true;');
    writeFileSync(join(checksDir, 'false.mjs'), 'export default () => false;');
    writeFileSync(join(checksDir, 'object.mjs'), 'export default () => ({ pass: true, reason: "looks good", score: 0.9 });');
    writeFileSync(join(checksDir, 'object-fail.mjs'), 'export default () => ({ pass: false, reason: "nope" });');
    writeFileSync(join(checksDir, 'async.mjs'), 'export default async () => ({ pass: true, reason: "async ok" });');

    const context = { fixture };

    expect(await check({ javascript: './checks/true.mjs' }, turn, [turn], context)).toMatchObject({ pass: true });
    expect(await check({ javascript: './checks/false.mjs' }, turn, [turn], context)).toMatchObject({ pass: false });
    expect(await check({ javascript: './checks/object.mjs' }, turn, [turn], context)).toMatchObject({ pass: true, reason: 'looks good', score: 0.9 });
    expect(await check({ javascript: './checks/object-fail.mjs' }, turn, [turn], context)).toMatchObject({ pass: false, reason: 'nope' });
    expect(await check({ javascript: './checks/async.mjs' }, turn, [turn], context)).toMatchObject({ pass: true, reason: 'async ok' });
  });

  it('javascript: throw, missing file, no default export, not- on a setup error still fails', async () => {
    const fixture = join(TMP, 'js-errors.chat.yaml');
    const checksDir = join(TMP, 'checks-errors');
    mkdirSync(checksDir, { recursive: true });

    writeFileSync(join(checksDir, 'throws.mjs'), 'export default () => { throw new Error("bad input"); };');
    writeFileSync(join(checksDir, 'no-default.mjs'), 'export const helper = () => true;');

    const context = { fixture };

    const thrown = await check({ javascript: './checks-errors/throws.mjs' }, turn, [turn], context);
    expect(thrown).toMatchObject({ pass: false });
    expect(thrown.reason).toContain('throws.mjs');
    expect(thrown.reason).toContain('bad input');

    const missing = await check({ javascript: './checks-errors/does-not-exist.mjs' }, turn, [turn], context);
    expect(missing).toMatchObject({ pass: false });
    expect(missing.reason).toContain('does-not-exist.mjs');

    const noDefault = await check({ javascript: './checks-errors/no-default.mjs' }, turn, [turn], context);
    expect(noDefault).toMatchObject({ pass: false, reason: expect.stringContaining('no default function') });

    expect(await check({ javascript: 123 }, turn, [turn], context)).toMatchObject({ pass: false, reason: 'javascript takes a path to a module' });

    // not- on a setup error must still fail, not flip to pass.
    const notMissing = await check({ 'not-javascript': './checks-errors/does-not-exist.mjs' }, turn, [turn], context);
    expect(notMissing).toMatchObject({ pass: false });
    expect(notMissing.reason).toContain('does-not-exist.mjs');
  });
});
