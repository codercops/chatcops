import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * `live` calls the APIs. `record` calls them and saves what came back.
 * `replay` answers every call from the saved recordings and never touches
 * the network, so CI needs no API keys.
 */
export type CassetteMode = 'live' | 'record' | 'replay';

/** One recorded HTTP call, a line of `__cassettes__/<eval file>.jsonl`. */
export interface CassetteEntry {
  test: string;
  /** Hash of the method, URL and body. */
  key: string;
  /** Kept so a changed request can say what changed. Headers are never saved. */
  request: { method: string; url: string; body?: unknown };
  response: { status: number; contentType?: string; body: string };
}

interface Scope {
  fixture: string;
  test: string;
  problems: string[];
}

interface Tally {
  byKey: Map<string, number>;
  byUrl: Map<string, number>;
}

/** Query parameters that can carry a key; dropped before hashing and saving. */
const SECRET_PARAMS = /^(key|api[-_]?key|token|access[-_]?token|secret)$/i;
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

/** `evals/pricing.chat.yaml` records to `evals/__cassettes__/pricing.chat.jsonl`. */
export function cassettePath(fixtureFile: string): string {
  return join(dirname(fixtureFile), '__cassettes__', `${basename(fixtureFile).replace(/\.(ya?ml|[cm]?[jt]s)$/i, '')}.jsonl`);
}

/**
 * Records and replays the HTTP calls each test makes: model steps, embedding
 * calls, a judge's calls, tools that call APIs. Calls are matched by a hash of
 * the request within their test, in the order they were made, so a changed
 * prompt, model or tool list misses the recording and fails instead of
 * passing on an old answer.
 */
export class Cassettes {
  readonly mode: CassetteMode;
  private readonly scope = new AsyncLocalStorage<Scope>();
  private readonly recorded = new Map<string, CassetteEntry[] | null>();
  private readonly fresh = new Map<string, CassetteEntry[]>();
  private readonly tallies = new Map<string, Tally>();

  constructor(mode: CassetteMode) {
    this.mode = mode;
  }

  /**
   * Routes `fetch` through the cassettes, for calls made inside `run()`.
   * Install it before the config is loaded, since SDKs and embedders can keep
   * a reference to `fetch` from when they were created. Returns the undo.
   */
  install(): () => void {
    const original = globalThis.fetch;
    const wrapped: typeof fetch = (input, init) => {
      const scope = this.scope.getStore();
      if (!scope || this.mode === 'live') return original(input, init);
      return this.handle(scope, original, new Request(input, init));
    };
    globalThis.fetch = wrapped;
    return () => {
      if (globalThis.fetch === wrapped) globalThis.fetch = original;
    };
  }

  /** Reads the recordings of the eval files about to run. Replay only. */
  async load(fixtures: string[]): Promise<void> {
    if (this.mode !== 'replay') return;
    for (const fixture of fixtures) this.recorded.set(fixture, await readEntries(cassettePath(fixture)));
  }

  /** Runs `fn` with its HTTP calls recorded or replayed as the test's. Returns what went wrong with the cassettes. */
  async run<T>(fixture: string, test: string, fn: () => Promise<T>): Promise<{ value: T; problems: string[] }> {
    const scope: Scope = { fixture, test, problems: [] };
    const value = await this.scope.run(scope, fn);
    return { value, problems: scope.problems };
  }

  /**
   * Writes what `record` saw. Recordings of the tests that ran are replaced,
   * those of tests no longer in the file are dropped, and the rest are kept,
   * so `--record --filter` updates only the tests it ran.
   */
  async save(fixtures: Array<{ path: string; ran: string[]; all: string[] }>): Promise<string[]> {
    if (this.mode !== 'record') return [];
    const written: string[] = [];
    for (const { path, ran, all } of fixtures) {
      const file = cassettePath(path);
      const existing = await readEntries(file);
      const fresh = this.fresh.get(path) ?? [];
      if (!existing && !fresh.length) continue;
      const kept = (existing ?? []).filter((entry) => all.includes(entry.test) && !ran.includes(entry.test));
      // Stable, so each test's calls stay in the order they were made.
      const entries = [...kept, ...fresh].sort((a, b) => all.indexOf(a.test) - all.indexOf(b.test));
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, entries.map((entry) => JSON.stringify(entry)).join('\n') + (entries.length ? '\n' : ''));
      written.push(file);
    }
    return written;
  }

  private async handle(scope: Scope, original: typeof fetch, request: Request): Promise<Response> {
    const described = await describeRequest(request);
    const key = hashRequest(described);
    const tally = this.tally(scope);
    const nth = bump(tally.byKey, key);
    const nthForUrl = bump(tally.byUrl, `${described.method} ${described.url}`);

    if (this.mode === 'replay') {
      const entries = this.recorded.get(scope.fixture);
      const entry = entries?.filter((e) => e.test === scope.test && e.key === key)[nth];
      if (!entry) {
        const problem = this.missMessage(scope, described, nthForUrl, entries);
        scope.problems.push(problem);
        // A 400, not a thrown error: SDKs retry network errors with backoff, but never a 400.
        return Response.json({ error: { type: 'invalid_request_error', message: problem } }, { status: 400 });
      }
      const { status, contentType, body } = entry.response;
      return new Response(NULL_BODY.has(status) ? null : body, { status, headers: contentType ? { 'content-type': contentType } : {} });
    }

    const response = await original(request);
    const body = await response.text();
    const contentType = response.headers.get('content-type') ?? undefined;
    const entry: CassetteEntry = { test: scope.test, key, request: described, response: { status: response.status, ...(contentType ? { contentType } : {}), body } };
    const list = this.fresh.get(scope.fixture) ?? [];
    list.push(entry);
    this.fresh.set(scope.fixture, list);
    const headers = new Headers(response.headers);
    // The body is already decoded and whole.
    headers.delete('content-encoding');
    headers.delete('content-length');
    return new Response(NULL_BODY.has(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers });
  }

  private tally(scope: Scope): Tally {
    const id = `${scope.fixture}\u0000${scope.test}`;
    let tally = this.tallies.get(id);
    if (!tally) {
      tally = { byKey: new Map(), byUrl: new Map() };
      this.tallies.set(id, tally);
    }
    return tally;
  }

  private missMessage(scope: Scope, request: CassetteEntry['request'], nthForUrl: number, entries: CassetteEntry[] | null | undefined): string {
    const where = `${request.method} ${request.url}`;
    const rerecord = 'Run chatcops test --record to record it again.';
    if (!entries) return `There's no recording for this eval file (${cassettePath(scope.fixture)}). Run chatcops test --record to make one.`;
    const sameUrl = entries.filter((e) => e.test === scope.test && `${e.request.method} ${e.request.url}` === where);
    const before = sameUrl[nthForUrl];
    if (!before) return `The test made a call that wasn't made when it was recorded (${where}). ${rerecord}`;
    const path = firstDifference(before.request.body, request.body);
    return `A call changed since it was recorded (${where}, at ${path ?? 'the body'}). ${rerecord}`;
  }
}

function bump(counts: Map<string, number>, key: string): number {
  const n = counts.get(key) ?? 0;
  counts.set(key, n + 1);
  return n;
}

async function readEntries(file: string): Promise<CassetteEntry[] | null> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null;
    throw error;
  }
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line, i) => {
      try {
        return JSON.parse(line) as CassetteEntry;
      } catch {
        throw new Error(`${file}:${i + 1} isn't valid JSON. Run chatcops test --record to record it again.`);
      }
    });
}

/** The parts of a request that decide its answer: method, URL without secrets, and the body (parsed when it's JSON). */
export async function describeRequest(request: Request): Promise<CassetteEntry['request']> {
  const url = new URL(request.url);
  for (const name of [...url.searchParams.keys()]) if (SECRET_PARAMS.test(name)) url.searchParams.delete(name);
  const text = request.body ? await request.clone().text() : '';
  let body: unknown;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { method: request.method, url: url.toString(), ...(body !== undefined ? { body } : {}) };
}

export function hashRequest(request: CassetteEntry['request']): string {
  return createHash('sha256')
    .update(`${request.method} ${request.url}\n${canonical(request.body)}`)
    .digest('hex')
    .slice(0, 16);
}

/** JSON with object keys sorted, so key order never changes the hash. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
}

/** Where two JSON values first differ, as a path like `messages[1].content`. Undefined when they're equal. */
export function firstDifference(a: unknown, b: unknown, path = ''): string | undefined {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const found = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (found) return found;
    }
    return undefined;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const found = firstDifference((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      if (found) return found;
    }
    return undefined;
  }
  return canonical(a) === canonical(b) ? undefined : path || '(root)';
}
