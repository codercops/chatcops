import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { githubReporter } from '../src/test/reporters/github.js';
import { sourceLines } from '../src/test/source-lines.js';
import type { TestResult, TestRunResult } from '../src/test/types.js';

const fixture = 'evals/pricing.chat.yaml';
function failure(test = 'refunds: 30 days, no receipt'): TestResult {
  const run: TestRunResult = {
    fixture, test, run: 1, pass: false,
    turns: [{
      turn: { user: 'price?', text: '$19', latencyMs: 1, toolCalls: [], sources: [], leads: [] },
      results: [{ assertion: { contains: '$29' }, pass: false, reason: 'Expected $29' }],
    }],
  };
  return { fixture, test, runs: [run], pass: false, passRate: 0 };
}

async function report(results: TestResult[], env: Record<string, string> = {}, cwd = dir) {
  const lines: string[] = [];
  await githubReporter({ write: (line) => lines.push(line) }, { cwd, env }).onEnd?.(results, { mode: 'live', elapsedMs: 1, costIncomplete: false });
  return lines;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'chatcops-github-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('emits one annotation per failed aggregate and omits passing aggregates even with a failed repeat', async () => {
  const first = failure();
  sourceLines.set(first, 11);
  first.runs.push({ ...first.runs[0], run: 2, turns: [], error: 'provider down' });
  const second = failure('module eval');
  second.fixture = 'evals/module.chat.mjs';
  delete second.runs[0].turns[0].results[0].reason;
  const passed = { ...first, pass: true, passRate: 0.5 };

  expect(await report([first, passed, second])).toEqual([
    '::error file=evals/pricing.chat.yaml,line=11,title=refunds%3A 30 days%2C no receipt::Run 1, turn 1: Expected $29%0ARun 2: provider down\n',
    '::error file=evals/module.chat.mjs,title=module eval::Run 1, turn 1: contains\n',
  ]);
});

it('escapes every special character in the message and both properties', async () => {
  const result = failure('title%0A\r\n:,');
  result.fixture = 'evals/file%0D\r\n:,.chat.yaml';
  result.runs[0].turns[0].results[0].reason = 'bad%0A\r\n::error title=other,::injected';
  sourceLines.set(result, 4);
  expect(await report([result])).toEqual([
    '::error file=evals/file%250D%0D%0A%3A%2C.chat.yaml,line=4,title=title%250A%0D%0A%3A%2C::Run 1, turn 1: bad%250A%0D%0A::error title=other,::injected\n',
  ]);
});

it('appends a table with both aggregate verdicts and escapes Markdown cells', async () => {
  const path = join(dir, 'summary.md');
  writeFileSync(path, 'Existing summary');
  const failed = failure('bad | row\r\n[link](url) <tag> & *em*');
  failed.fixture = 'evals/a|b\rname.chat.yaml';
  failed.passRate = 1 / 3;
  const passed = { ...failure('good'), pass: true, passRate: 0.5 };
  await report([failed, passed], { GITHUB_STEP_SUMMARY: path });
  expect(readFileSync(path, 'utf8')).toBe(
    'Existing summary\n\n### ChatCops evaluations\n\n| Eval file | Test | Result | Pass rate |\n| --- | --- | --- | --- |\n' +
    '| evals/a&#124;b name.chat.yaml | bad &#124; row &#91;link&#93;(url) &#60;tag&#62; &#38; &#42;em&#42; | Failed | 33.3% |\n' +
    '| evals/pricing.chat.yaml | good | Passed | 50% |\n'
  );
});

it('only emits annotations when the summary variable is unset', async () => {
  expect(await report([failure()])).toHaveLength(1);
  expect(await report([{ ...failure(), pass: true, passRate: 1 }])).toEqual([]);
});

it('resolves annotation files from the GitHub workspace', async () => {
  const site = join(dir, 'site');
  expect(await report([failure()], { GITHUB_WORKSPACE: dir }, site)).toEqual([
    '::error file=site/evals/pricing.chat.yaml,title=refunds%3A 30 days%2C no receipt::Run 1, turn 1: Expected $29\n',
  ]);
});

it('reports the summary path if appending fails', async () => {
  await expect(report([failure()], { GITHUB_STEP_SUMMARY: dir })).rejects.toThrow(`Cannot append GitHub Actions summary to "${dir}"`);
});
