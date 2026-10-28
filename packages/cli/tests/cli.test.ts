import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXIT, main, toSource } from '../src/index.js';
import { fixtureSite, type FixtureSite } from '../../ingest/tests/site.js';

const TMP = resolve(__dirname, '.tmp');
let site: FixtureSite;

beforeAll(async () => {
  site = await fixtureSite();
  mkdirSync(TMP, { recursive: true });
});
afterAll(async () => {
  await site.close();
  rmSync(TMP, { recursive: true, force: true });
});

/**
 * A folder with a chatcops.config.mjs. Configs with the same `shared` name use
 * the same in-memory storage (kept on globalThis), so one can build an index
 * and another search it.
 */
function project(options: { shared: string; embedderId?: string; body?: string } = { shared: 'default' }): string {
  const dir = mkdtempSync(join(TMP, 'project-'));
  const embedderId = options.embedderId ?? 'test:fake@4';
  writeFileSync(
    join(dir, 'chatcops.config.mjs'),
    options.body ??
      `import { memoryStorage, memoryVectors } from '@chatcops/core';
const key = '__chatcops_cli_${options.shared}';
globalThis[key] ??= { storage: { ...memoryStorage(), vectors: memoryVectors({ dimensions: 4 }) }, embedded: [] };
const shared = globalThis[key];
export default {
  storage: shared.storage,
  embedder: {
    id: '${embedderId}',
    dimensions: 4,
    async embed(texts) {
      shared.embedded.push(...texts);
      return texts.map((t) => Float32Array.from([1, /refund/i.test(t) ? 5 : 0, /pricing|plan/i.test(t) ? 5 : 0, 1]));
    },
  },
  ingest: { sources: [{ type: 'urls', urls: ['${site.url}/pricing'] }] },
};
`
  );
  return dir;
}

async function run(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, { stdout: { write: (t: string) => (stdout += t) }, stderr: { write: (t: string) => (stderr += t) }, cwd });
  return { code, stdout, stderr };
}

describe('chatcops', () => {
  it('prints help, the version, and refuses unknown commands and flags', async () => {
    const cwd = TMP;
    expect((await run(['--help'], cwd)).stdout).toContain('chatcops ingest [options]');
    expect(await run([], cwd)).toMatchObject({ code: EXIT.unusable });
    expect((await run(['--version'], cwd)).stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
    expect(await run(['deploy'], cwd)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('Unknown command "deploy"') });
    expect(await run(['ingest', '--nope'], cwd)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining("Unknown option '--nope'") });
    expect(await run(['ingest', '--max-pages', 'ten'], cwd)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('--max-pages takes a whole number') });
  });

  it('explains a missing or incomplete config', async () => {
    const empty = mkdtempSync(join(TMP, 'empty-'));
    expect(await run(['ingest'], empty)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('No config file found') });
    const noEmbedder = project({ shared: 'x', body: 'export default { storage: {} };\n' });
    expect(await run(['ingest'], noEmbedder)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('needs an `embedder`') });
    const noDefault = project({ shared: 'x', body: 'export const config = {};\n' });
    expect(await run(['ingest'], noDefault)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('has no default export') });
    expect(await run(['ingest', '--config', 'missing.mjs'], noDefault)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('No config file at') });
  });

  it('ingests the sources in the config, then embeds nothing on a second run', async () => {
    const cwd = project({ shared: 'rerun' });
    const first = await run(['ingest'], cwd);
    expect(first.code).toBe(EXIT.ok);
    expect(first.stderr).toContain('Found 1 page.');
    expect(first.stderr).toMatch(/indexed\s+http:\/\/127\.0\.0\.1:\d+\/pricing \(\d+ chunks?\)/);
    expect(first.stdout).toMatch(/^Indexed 1 of 1 pages: \d+ chunks, \d+ embedded\./);

    const second = await run(['ingest'], cwd);
    expect(second.stdout).toContain('0 embedded');
    expect(second.stdout).toContain('1 unchanged');
  });

  it('takes --source and --index, writes JSON lines with --json, and exits 1 when a page fails', async () => {
    const cwd = project({ shared: 'json' });
    const { code, stdout } = await run(
      ['ingest', '--source', `${site.url}/sitemap.xml`, '--source', `${site.url}/gone`, '--index', 'docs', '--json'],
      cwd
    );
    expect(code).toBe(EXIT.problems);
    const lines = stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ type: 'discovered', pages: 5 });
    expect(lines.filter((line) => line.type === 'page' && line.status === 'failed')).toEqual([
      expect.objectContaining({ url: `${site.url}/gone`, reason: 'HTTP 404' }),
    ]);
    expect(lines.at(-1)).toMatchObject({ type: 'done', dryRun: false, stats: { indexed: 3, failed: 1, skipped: 1 } });
  });

  it('writes and embeds nothing with --dry-run', async () => {
    const cwd = project({ shared: 'dry' });
    const { code, stdout } = await run(['ingest', '--dry-run'], cwd);
    expect(code).toBe(EXIT.ok);
    expect(stdout).toMatch(/^Would index 1 of 1 pages: \d+ chunks, 0 embedded\./);
    expect((globalThis as unknown as Record<string, { embedded: string[] }>).__chatcops_cli_dry.embedded).toEqual([]);
  });

  it('searches the index it built, as text or JSON', async () => {
    const cwd = project({ shared: 'search' });
    await run(['ingest', '--source', `${site.url}/sitemap.xml`], cwd);

    const text = await run(['search', 'refund', 'policy'], cwd);
    expect(text.code).toBe(EXIT.ok);
    expect(text.stdout).toMatch(/^1\. Refund policy/);
    expect(text.stdout).toContain(`${site.url}/refunds`);

    const json = await run(['search', 'pricing plans', '--top-k', '2', '--json'], cwd);
    const result = JSON.parse(json.stdout) as { question: string; index: string; chunks: Array<{ source: { url: string } }> };
    expect(result).toMatchObject({ question: 'pricing plans', index: 'default' });
    expect(result.chunks.length).toBeLessThanOrEqual(2);
    expect(result.chunks[0].source.url).toContain('pricing');
  });

  it('refuses to search an index with a different embedder than built it', async () => {
    const built = project({ shared: 'mismatch' });
    await run(['ingest'], built);
    const other = project({ shared: 'mismatch', embedderId: 'other:model@4' });
    expect(await run(['search', 'price'], other)).toMatchObject({
      code: EXIT.unusable,
      stderr: expect.stringContaining('was built with test:fake@4, but the config\'s embedder is other:model@4'),
    });
    expect(await run(['ingest'], other)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('Index "default" was built with test:fake@4') });
  });

  it('says so when searching an index that was never built, and needs a question', async () => {
    const cwd = project({ shared: 'never' });
    const result = await run(['search', 'anything'], cwd);
    expect(result).toMatchObject({ code: EXIT.ok, stdout: 'Nothing found.\n' });
    expect(result.stderr).toContain(`hasn't been built yet`);
    expect(await run(['search'], cwd)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('What should I search for?') });
  });

  it('needs --base-url for a folder source', async () => {
    const cwd = project({ shared: 'folder' });
    expect(await run(['ingest', '--source', './docs'], cwd)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('needs --base-url') });
  });
});

describe('toSource', () => {
  it('tells sitemaps, pages and folders apart', () => {
    expect(toSource('https://acme.test/sitemap.xml', undefined, '/x')).toEqual({ type: 'sitemap', url: 'https://acme.test/sitemap.xml' });
    expect(toSource('https://acme.test/sitemap.xml.gz?v=2', undefined, '/x')).toEqual({ type: 'sitemap', url: 'https://acme.test/sitemap.xml.gz?v=2' });
    expect(toSource('https://acme.test/pricing', undefined, '/x')).toEqual({ type: 'urls', urls: ['https://acme.test/pricing'] });
    expect(toSource('docs', 'https://docs.acme.test', '/x')).toEqual({ type: 'directory', path: '/x/docs', baseUrl: 'https://docs.acme.test' });
  });
});

describe('the built command', () => {
  it('runs from dist/bin.js', () => {
    const bin = resolve(__dirname, '../dist/bin.js');
    const out = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    expect(out).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
