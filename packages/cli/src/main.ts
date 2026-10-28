import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hybridRetriever, vectorRetriever, type RetrievedChunk } from '@chatcops/core';
import { ingest, manifestKeys, type IngestEvent, type IngestSource, type IngestStats } from '@chatcops/ingest';
import { ConfigError, indexConfig, loadConfig, serverConfig } from './config.js';
import { runTests } from './test/command.js';

export interface Io {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
  cwd: string;
}

/** Exit codes: 0 done, 1 finished with problems (failed pages, discovery errors), 2 couldn't run. */
export const EXIT = { ok: 0, problems: 1, unusable: 2 } as const;

const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();

const HELP = `chatcops ${VERSION}

Usage:
  chatcops ingest [options]          Build or update the knowledge index from your site
  chatcops search "<question>" [options]   Show what retrieval finds for a question
  chatcops test [files...] [options]        Run eval files against your bot

Ingest options:
  --source <url|path>   A sitemap (.xml, .xml.gz), a page URL, or a folder of .md/.mdx/.html
                        files (with --base-url). Repeatable. Replaces the config's sources.
  --base-url <url>      Where a folder source is published
  --index <name>        Index name (default "default")
  --dry-run             Discover, extract and chunk; write and embed nothing
  --max-pages <n>       Index at most n pages
  --concurrency <n>     Pages fetched at once (default 4)
  --prune               Remove pages that are gone (never after a discovery error)
  --force               Re-embed every page, even unchanged ones
  --json                One JSON object per line, for CI

Search options:
  --index <name>        Index name (default "default")
  --top-k <n>           Chunks to show (default 5)
  --json                JSON output

Test options:
  [files...]            Globs of eval files (default "evals/**/*.chat.yaml")
  --filter <text>       Only tests whose name contains text, or tag:<name>
  --repeat <n>          Run each test n times
  --concurrency <n>     Tests run at once (default 4)
  --json                Results as JSON

All commands:
  --config <file>       Config file (default: chatcops.config.ts, .mts, .js or .mjs here)
  -h, --help            Show this help
  -v, --version         Show the version
`;

/** Runs the command line and returns the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.stderr.write(`${message(error)}\n\nRun chatcops --help for usage.\n`);
    return EXIT.unusable;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    io.stdout.write(`${VERSION}\n`);
    return EXIT.ok;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    io.stdout.write(HELP);
    return command || values.help ? EXIT.ok : EXIT.unusable;
  }

  try {
    if (command === 'ingest') return await runIngest(values, io);
    if (command === 'search') return await runSearch(rest.join(' '), values, io);
    if (command === 'test') {
      const loaded = await loadConfig(io.cwd, values.config);
      try {
        return await runTests(serverConfig(loaded), rest, values, io);
      } finally {
        await loaded.close();
      }
    }
    io.stderr.write(`Unknown command "${command}". Run chatcops --help for usage.\n`);
    return EXIT.unusable;
  } catch (error) {
    io.stderr.write(`${error instanceof ConfigError ? '' : 'Error: '}${message(error)}\n`);
    return EXIT.unusable;
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      source: { type: 'string', multiple: true },
      'base-url': { type: 'string' },
      index: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'max-pages': { type: 'string' },
      concurrency: { type: 'string' },
      prune: { type: 'boolean' },
      force: { type: 'boolean' },
      json: { type: 'boolean' },
      'top-k': { type: 'string' },
      filter: { type: 'string' },
      repeat: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
}

export type Values = ReturnType<typeof parse>['values'];

async function runIngest(values: Values, io: Io): Promise<number> {
  const maxPages = wholeNumber(values['max-pages'], '--max-pages');
  const concurrency = wholeNumber(values.concurrency, '--concurrency');
  const loaded = await loadConfig(io.cwd, values.config);
  try {
    const target = indexConfig(loaded);
    const sources = values.source?.length ? values.source.map((source) => toSource(source, values['base-url'], io.cwd)) : loaded.config.ingest?.sources;
    if (!sources?.length) throw new ConfigError('Nothing to ingest: pass --source, or set ingest.sources in the config.');

    const json = !!values.json;
    const stats = await ingest({
      ...loaded.config.ingest,
      sources,
      ...(values.index ? { index: values.index } : {}),
      ...(maxPages !== undefined ? { maxPages } : {}),
      ...(concurrency !== undefined ? { concurrency } : {}),
      embedder: target.embedder,
      store: target.store,
      manifest: target.manifest,
      dryRun: !!values['dry-run'],
      force: !!values.force,
      prune: !!values.prune,
      onEvent: (event) => (json ? io.stdout.write(`${JSON.stringify(event)}\n`) : io.stderr.write(describe(event))),
    });

    if (json) io.stdout.write(`${JSON.stringify({ type: 'done', dryRun: !!values['dry-run'], stats })}\n`);
    else io.stdout.write(summary(stats, !!values['dry-run']));
    return stats.failed || stats.errors.length ? EXIT.problems : EXIT.ok;
  } finally {
    await loaded.close();
  }
}

async function runSearch(question: string, values: Values, io: Io): Promise<number> {
  if (!question.trim()) throw new ConfigError('What should I search for? chatcops search "how much is the Team plan?"');
  const topK = wholeNumber(values['top-k'], '--top-k') ?? 5;
  const loaded = await loadConfig(io.cwd, values.config);
  try {
    const index = values.index ?? 'default';
    const { embedder, store, manifest } = indexConfig(loaded);
    const meta = await manifest.get<{ embedder: string }>(manifestKeys(index).meta);
    if (meta && meta.embedder !== embedder.id) {
      throw new ConfigError(
        `Index "${index}" was built with ${meta.embedder}, but the config's embedder is ${embedder.id}. Search it with the embedder that built it.`
      );
    }
    if (!meta) io.stderr.write(`Index "${index}" hasn't been built yet. Run chatcops ingest first.\n`);
    const options = { store, embedder };
    const retriever = store.keywordQuery ? hybridRetriever(options) : vectorRetriever(options);
    const chunks = await retriever.retrieve({ text: question, topK });

    if (values.json) io.stdout.write(`${JSON.stringify({ question, index, chunks })}\n`);
    else io.stdout.write(chunks.length ? chunks.map(formatChunk).join('\n') : 'Nothing found.\n');
    return EXIT.ok;
  } finally {
    await loaded.close();
  }
}

/** A `--source` value: a sitemap URL, a page URL, or a folder (with `--base-url`). */
export function toSource(value: string, baseUrl: string | undefined, cwd: string): IngestSource {
  if (/^https?:\/\//i.test(value)) {
    return /\.xml(\.gz)?(\?.*)?$/i.test(value) ? { type: 'sitemap', url: value } : { type: 'urls', urls: [value] };
  }
  if (!baseUrl) throw new ConfigError(`--source ${value} is a folder, so it needs --base-url (where those pages are published).`);
  return { type: 'directory', path: resolve(cwd, value), baseUrl };
}

function describe(event: IngestEvent): string {
  if (event.type === 'discovered') {
    return `Found ${event.pages} page${event.pages === 1 ? '' : 's'}.${event.errors.map((error) => `\n  ! ${error}`).join('')}\n`;
  }
  if (event.type === 'pruned') return `  removed    ${event.url}\n`;
  const detail = event.chunks !== undefined ? ` (${event.chunks} chunk${event.chunks === 1 ? '' : 's'})` : event.reason ? ` (${event.reason})` : '';
  return `  ${event.status.padEnd(10)} ${event.url}${detail}\n`;
}

function summary(stats: IngestStats, dryRun: boolean): string {
  const lines = [
    `${dryRun ? 'Would index' : 'Indexed'} ${stats.indexed} of ${stats.discovered} pages: ${stats.chunks} chunks, ${stats.embedded} embedded.`,
    `${stats.unchanged} unchanged, ${stats.skipped} skipped, ${stats.failed} failed, ${stats.pruned} ${dryRun ? 'to remove' : 'removed'}.`,
  ];
  if (stats.pruneSkipped) lines.push(`Didn't remove anything: ${stats.pruneSkipped}.`);
  if (stats.errors.length) lines.push(...stats.errors.map((error) => `! ${error}`));
  return `${lines.join('\n')}\n`;
}

function formatChunk(chunk: RetrievedChunk, i: number): string {
  const title = [chunk.source.title, chunk.source.section].filter(Boolean).join(' > ') || chunk.source.url;
  const text = chunk.text.replace(/\s+/g, ' ').trim();
  return `${i + 1}. ${title}  (${chunk.score.toFixed(4)})\n   ${chunk.source.url}\n   ${text.length > 240 ? `${text.slice(0, 239)}…` : text}\n`;
}

export function wholeNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new ConfigError(`${flag} takes a whole number, not "${value}".`);
  return Number(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
