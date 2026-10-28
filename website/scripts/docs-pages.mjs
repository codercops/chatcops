// The docs pages the docs bot's index is built from, with a hash of each, so
// a change to any of them shows the index is out of date.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const SITE = 'https://chat.codercops.com/';
export const DOCS_INDEX_DIMENSIONS = 512;

export function docsPages(root) {
  const dir = join(root, 'src', 'content', 'docs');
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(md|mdx)$/.test(entry.name))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
      .map((file) => [relative(dir, file).split(sep).join('/'), createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16)])
  );
}
