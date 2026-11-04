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
function project(options: { shared: string; embedderId?: string; index?: string; body?: string } = { shared: 'default' }): string {
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
  ingest: { ${options.index ? `index: '${options.index}', ` : ''}sources: [{ type: 'urls', urls: ['${site.url}/pricing'] }] },
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
    expect((await run(['--version'], cwd)).stdout).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?\n$/);
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

  describe('--contextualize', () => {
    type Shared = { embedded: string[]; model: { calls: unknown[] } };
    const shared = (name: string) => (globalThis as unknown as Record<string, Shared>)[`__chatcops_cli_${name}`];

    /** A config whose model answers "Context N." to the Nth chunk, and counts its calls on globalThis. */
    function withModel(name: string, options: { provider?: boolean } = {}): string {
      return project({
        shared: name,
        body: `import { memoryStorage, memoryVectors } from '@chatcops/core';
import { scriptedProvider, textStep } from '@chatcops/core/testing';
const key = '__chatcops_cli_${name}';
globalThis[key] ??= { storage: { ...memoryStorage(), vectors: memoryVectors({ dimensions: 4 }) }, embedded: [] };
const shared = globalThis[key];
shared.model ??= scriptedProvider(Array.from({ length: 50 }, (_, i) => () => textStep('Context ' + (i + 1) + '.', { usage: { inputTokens: 100, outputTokens: 10 } })));
export default {
  storage: shared.storage,
  embedder: { id: 'test:fake@4', dimensions: 4, async embed(texts) { shared.embedded.push(...texts); return texts.map(() => Float32Array.from([1, 0, 0, 1])); } },
  ingest: { sources: [{ type: 'urls', urls: ['${site.url}/pricing'] }]${options.provider === false ? '' : ', contextualize: { provider: shared.model }'} },
};
`,
      });
    }

    it('lists the flag in the help', async () => {
      expect((await run(['--help'], project({ shared: 'ctx-help' }))).stdout).toContain('--contextualize');
    });

    it('has the model in ingest.contextualize.provider write context for each chunk, and reports what it used', async () => {
      const cwd = withModel('ctx-on');
      const { code, stdout } = await run(['ingest', '--contextualize'], cwd);
      expect(code).toBe(EXIT.ok);
      const { embedded, model } = shared('ctx-on');
      expect(model.calls.length).toBeGreaterThan(0);
      expect(embedded).toHaveLength(model.calls.length);
      expect(embedded[0]).toMatch(/^Context 1\.\n\n/);
      expect(stdout).toMatch(/Context written for \d+ chunks by the model \(\d+ input, \d+ output tokens\)\./);
    });

    it('puts the chunk count and the model tokens in the --json output, next to the embedded count', async () => {
      const cwd = withModel('ctx-json');
      const { stdout } = await run(['ingest', '--contextualize', '--json'], cwd);
      const done = stdout.trim().split('\n').map((line) => JSON.parse(line)).at(-1);
      const chunks = shared('ctx-json').model.calls.length;
      expect(done).toMatchObject({ type: 'done', stats: { embedded: chunks, contextualized: chunks, modelTokens: { inputTokens: chunks * 100, outputTokens: chunks * 10 } } });
    });

    it('asks no model without the flag, even when the config has a provider', async () => {
      const cwd = withModel('ctx-off');
      const { code, stdout } = await run(['ingest'], cwd);
      expect(code).toBe(EXIT.ok);
      expect(shared('ctx-off').model.calls).toHaveLength(0);
      expect(shared('ctx-off').embedded[0]).not.toMatch(/^Context/);
      expect(stdout).not.toContain('Context written');
    });

    it('fails with a clear message, before embedding anything, when the config has no provider for it', async () => {
      const cwd = withModel('ctx-none', { provider: false });
      const { code, stderr } = await run(['ingest', '--contextualize'], cwd);
      expect(code).toBe(EXIT.unusable);
      expect(stderr).toContain('--contextualize needs a model: set ingest.contextualize.provider in the config');
      expect(shared('ctx-none').embedded).toEqual([]);
      const plain = await run(['ingest', '--contextualize'], project({ shared: 'ctx-plain' }));
      expect(plain).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('--contextualize needs a model') });
    });

    it('asks no model with --dry-run', async () => {
      const cwd = withModel('ctx-dry');
      const { code, stdout } = await run(['ingest', '--contextualize', '--dry-run'], cwd);
      expect(code).toBe(EXIT.ok);
      expect(shared('ctx-dry').model.calls).toHaveLength(0);
      expect(shared('ctx-dry').embedded).toEqual([]);
      expect(stdout).not.toContain('Context written');
    });

    it('embeds an unchanged page again when the flag is turned on, and not on a second run with it', async () => {
      const cwd = withModel('ctx-toggle');
      await run(['ingest'], cwd);
      const on = await run(['ingest', '--contextualize'], cwd);
      expect(on.stdout).toMatch(/^Indexed 1 of 1 pages/);
      const again = await run(['ingest', '--contextualize'], cwd);
      expect(again.stdout).toContain('0 embedded');
      expect(again.stdout).toContain('1 unchanged');
    });
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

  it('searches the index named in ingest.index', async () => {
    const cwd = project({ shared: 'named', index: 'docs' });
    await run(['ingest'], cwd);
    const json = await run(['search', 'pricing', '--json'], cwd);
    expect(json.stderr).not.toContain(`hasn't been built yet`);
    const result = JSON.parse(json.stdout) as { index: string; chunks: Array<{ source: { url: string } }> };
    expect(result.index).toBe('docs');
    expect(result.chunks[0].source.url).toBe(`${site.url}/pricing`);

    const other = project({ shared: 'named', index: 'docs', embedderId: 'other:model@4' });
    expect(await run(['search', 'pricing'], other)).toMatchObject({ code: EXIT.unusable, stderr: expect.stringContaining('Index "docs" was built with test:fake@4') });
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

  it('ingests with --crawl and crawl: source', async () => {
    site.set('/crawl/cli/start', '<!doctype html><html><body><main><h1>Start</h1><p>Start with <a href="/crawl/cli/sub">Sub</a></p></main></body></html>');
    site.set('/crawl/cli/sub', '<!doctype html><html><body><main><h1>Sub</h1><p>Sub content</p></main></body></html>');
    const cwd = project({ shared: 'cli-crawl' });
    try {
      const crawlFlag = await run(['ingest', '--crawl', `${site.url}/crawl/cli/start`], cwd);
      expect(crawlFlag.code).toBe(EXIT.ok);
      expect(crawlFlag.stdout).toContain('Indexed 2 of 2 pages');

      const crawlSource = await run(['ingest', '--source', `crawl:${site.url}/crawl/cli/start`, '--force'], cwd);
      expect(crawlSource.code).toBe(EXIT.ok);
      expect(crawlSource.stdout).toContain('Indexed 2 of 2 pages');
    } finally {
      for (const p of ['/crawl/cli/start', '/crawl/cli/sub']) site.remove(p);
    }
  });
});

describe('toSource', () => {
  it('tells sitemaps, pages and folders apart', () => {
    expect(toSource('crawl:https://acme.test/start', undefined, '/x')).toEqual({ type: 'crawl', url: 'https://acme.test/start' });
    expect(toSource('https://acme.test/sitemap.xml', undefined, '/x')).toEqual({ type: 'sitemap', url: 'https://acme.test/sitemap.xml' });
    expect(toSource('https://acme.test/sitemap.xml.gz?v=2', undefined, '/x')).toEqual({ type: 'sitemap', url: 'https://acme.test/sitemap.xml.gz?v=2' });
    expect(toSource('https://acme.test/pricing', undefined, '/x')).toEqual({ type: 'urls', urls: ['https://acme.test/pricing'] });
    expect(toSource('docs', 'https://docs.acme.test', TMP)).toEqual({ type: 'directory', path: join(TMP, 'docs'), baseUrl: 'https://docs.acme.test' });
  });
});

describe('the built command', () => {
  it('runs from dist/bin.js', () => {
    const bin = resolve(__dirname, '../dist/bin.js');
    const out = execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' });
    expect(out).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?\n$/);
  });
});
