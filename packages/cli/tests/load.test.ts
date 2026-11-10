import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loadFixture } from '../src/test/load.js';
import { sourceLines } from '../src/test/source-lines.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'chatcops-load-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it('keeps exact YAML entry lines after defaults, including comments and a standalone dash', async () => {
  const path = join(dir, 'positions.chat.yaml');
  writeFileSync(path, [
    'version: 1',
    'name: Positions',
    'defaults: { repeat: 2 }',
    'tests:',
    '    # First eval',
    '    - name: first',
    '      turns: [{ user: hello }]',
    '',
    '    # Second eval',
    '    -',
    '      name: second',
    '      turns: [{ user: goodbye }]',
  ].join('\r\n'));
  const fixture = await loadFixture(path);
  expect(fixture.tests.map((test) => sourceLines.get(test))).toEqual([6, 10]);
  expect(fixture.tests.map((test) => test.repeat)).toEqual([2, 2]);
  expect(JSON.parse(JSON.stringify(fixture.tests[0]))).toEqual({
    name: 'first', repeat: 2, turns: [{ user: 'hello' }], mocks: { tools: {} },
  });
});

it('gets flow-sequence entry lines from node ranges', async () => {
  const path = join(dir, 'flow.chat.yaml');
  writeFileSync(path, 'version: 1\nname: Flow\ntests: [\n  { name: first, turns: [{ user: hi }] },\n  { name: second, turns: [{ user: bye }] }\n]\n');
  const fixture = await loadFixture(path);
  expect(fixture.tests.map((test) => sourceLines.get(test))).toEqual([4, 5]);
});

it('keeps module fixtures line-free', async () => {
  const path = join(dir, 'module.chat.mjs');
  writeFileSync(path, 'export default { version: 1, name: "Module", tests: [{ name: "one", turns: [{ user: "hi" }] }] };');
  const fixture = await loadFixture(path);
  expect(fixture.tests[0].name).toBe('one');
  expect(sourceLines.has(fixture.tests[0])).toBe(false);
});

it('keeps source positions outside the YAML schema', async () => {
  const path = join(dir, 'invalid.chat.yaml');
  writeFileSync(path, 'version: 1\nname: Invalid\ntests: [{ name: one, line: 7, turns: [{ user: hi }] }]\n');
  await expect(loadFixture(path)).rejects.toThrow(/Unrecognized key.*line/);
});
