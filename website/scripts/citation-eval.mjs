// The docs bot's citation eval: runs evals/docs-citations.chat.yaml (replayed
// from evals/__cassettes__) and passes when at least 85% of the answers cite
// the page that answers them. Each miss is listed, either way.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = 0.85;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = spawnSync(process.execPath, [join(root, '..', 'packages', 'cli', 'dist', 'bin.js'), 'test', '--replay', '--json', 'evals/docs-citations.chat.yaml'], {
  cwd: root,
  encoding: 'utf8',
});
if (run.status === 2 || !run.stdout.trim()) {
  process.stderr.write(run.stderr);
  process.exit(2);
}

const { results } = JSON.parse(run.stdout);
const errors = results.filter((result) => result.runs.some((r) => r.error));
if (errors.length) {
  // A replay with no recording is a stale cassette, not a wrong citation.
  for (const result of errors) console.log(`! ${result.test}: ${result.runs.find((r) => r.error).error}`);
  console.log('\nThe recordings are out of date. A maintainer runs npm run evals:record in website/.');
  process.exit(1);
}
const misses = results.filter((result) => !result.pass);
for (const miss of misses) {
  const turn = miss.runs[0].turns.at(-1);
  const cited = turn.turn.sources.map((source) => new URL(source.url).pathname).join(', ') || 'nothing';
  console.log(`✗ ${miss.test}  (cited ${cited})`);
}
const share = (results.length - misses.length) / results.length;
console.log(`\n${results.length - misses.length} of ${results.length} answers cite the right page (${Math.round(share * 100)}%, needs ${Math.round(TARGET * 100)}%).`);
process.exit(share >= TARGET ? 0 : 1);
