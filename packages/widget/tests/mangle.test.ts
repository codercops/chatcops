import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECKED } from '../mangle.js';

// The minifier renames these everywhere in the bundle. Each one has to be a
// private member that the code only touches through `this`, or the CDN build
// breaks where the unit tests (which run on src) can't see it.

const root = join(__dirname, '..');
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.ts')) files.push(path);
  }
};
walk(join(root, 'src'));
const source = files.map((file) => readFileSync(file, 'utf8')).join('\n');
const api = readFileSync(join(root, '../../api/widget.api.md'), 'utf8');
const domPrototypes = [
  window,
  Document.prototype,
  ShadowRoot.prototype,
  HTMLElement.prototype,
  HTMLButtonElement.prototype,
  HTMLTextAreaElement.prototype,
  HTMLInputElement.prototype,
  HTMLFormElement.prototype,
  HTMLSelectElement.prototype,
  Storage.prototype,
  Response.prototype,
  AbortController.prototype,
];

describe.each(CHECKED)('the mangled property %s', (name) => {
  it('is declared private', () => {
    expect(source).toMatch(new RegExp(`^\\s+private (?:readonly |async )*${name}\\b`, 'm'));
  });

  it('is only used through this', () => {
    const elsewhere = source.match(new RegExp(`.{0,30}(?<!\\bthis)\\.${name}\\b.{0,10}`));
    expect(elsewhere?.[0]).toBeUndefined();
  });

  it('is never an object key, a shorthand property or a string', () => {
    const lines = source.split('\n').filter((line) => !/^\s+private\b/.test(line) && !/^\s*(\/\/|\*)/.test(line));
    const keyed = lines.find((line) => new RegExp(`(^|[^.\\w])${name}\\??\\s*:`).test(line.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, '')));
    expect(keyed).toBeUndefined();
    expect(source.replaceAll(`this.${name}`, '')).not.toMatch(new RegExp(`[{,]\\s*${name}\\s*[,}]`));
    expect(source).not.toMatch(new RegExp(`['"\`]${name}['"\`]`));
  });

  it('is not part of the public API or a DOM name', () => {
    expect(api).not.toMatch(new RegExp(`\\b${name}\\b`));
    expect(domPrototypes.filter((proto) => name in proto)).toEqual([]);
  });
});
