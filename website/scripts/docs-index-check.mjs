// Says when the docs pages changed since the docs bot's index was built.
// A warning, not a failure: rebuilding needs an OpenAI key, which contributors
// don't have. A maintainer runs `npm run docs-index` before a release.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { docsPages } from './docs-pages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = JSON.parse(readFileSync(join(root, 'public', 'docs-index', 'chunks.json'), 'utf8')).pages;
const now = docsPages(root);
const changed = [...new Set([...Object.keys(built), ...Object.keys(now)])].filter((page) => built[page] !== now[page]).sort();

if (!changed.length) {
  console.log('The docs bot index is up to date.');
} else {
  const list = changed.map((page) => `${page} (${!built[page] ? 'new' : !now[page] ? 'removed' : 'changed'})`).join(', ');
  const message = `The docs bot index is out of date: ${list}. A maintainer runs npm run docs-index in website/ to rebuild it.`;
  console.log(process.env.GITHUB_ACTIONS ? `::warning::${message}` : message);
}
