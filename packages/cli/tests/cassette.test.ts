import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXIT, main } from '../src/index.js';
import { Cassettes, cassettePath, describeRequest, firstDifference, hashRequest } from '../src/test/cassette.js';

const TMP = resolve(__dirname, '.tmp-cassette');
let server: Server;
let modelUrl: string;
let hits: Array<{ url: string; auth?: string; body: string }> = [];

/** A stand-in for a model API: answers from the last message, and counts calls. */
beforeAll(async () => {
  mkdirSync(TMP, { recursive: true });
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      hits.push({ url: req.url ?? '', auth: req.headers.authorization, body });
      if (req.url?.startsWith('/empty')) return res.writeHead(204).end();
      if (req.url?.startsWith('/big')) return res.writeHead(200, { 'content-type': 'text/event-stream' }).end(Array.from({ length: 400 }, (_, i) => `data: {"n":${i}}\n\n`).join(''));
      if (req.url?.startsWith('/down')) return res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"overloaded"}');
      const { messages } = JSON.parse(body) as { messages: Array<{ role: string; content: string }> };
      // The reply in progress comes last, so read the latest user message.
      const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const text = /price/i.test(last) ? 'The Team plan is $19 a month.' : /flip/i.test(last) ? (hits.length % 2 ? 'heads' : 'tails') : 'Hello!';
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text }));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  modelUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((done) => server.close(done));
  rmSync(TMP, { recursive: true, force: true });
});
beforeEach(() => {
  hits = [];
});

/** A bot whose provider calls the stand-in model with `fetch`, with a key in a header and in the query. */
function config(systemPrompt = 'You are a test bot.', path = '/v1/chat') {
  return `import { textStep } from '@chatcops/core/testing/provider';
export default {
  server: {
    systemPrompt: ${JSON.stringify(systemPrompt)},
    provider: {
      name: 'http',
      model: 'http-1',
      async *step({ messages, systemPrompt }) {
        const res = await fetch('${modelUrl}${path}?key=sk-secret-query&v=1', {
          method: 'POST',
          headers: { authorization: 'Bearer sk-secret-header', 'content-type': 'application/json' },
          body: JSON.stringify({ system: systemPrompt, messages: messages.map((m) => ({ role: m.role, content: m.content })) }),
        });
        if (!res.ok) throw new Error('model said ' + res.status);
        const { text } = await res.json();
        for (const event of textStep(text)) yield event;
      },
    },
  },
};
`;
}

const PRICING = `version: 1
name: Pricing
tests:
  - name: price
    turns:
      - user: What's the price?
        expect: [{ contains: "$19" }]
  - name: hello
    turns:
      - user: hi
      - user: hi again
        expect: [{ contains: Hello }]
`;

function project(files: Record<string, string>, body = config()): string {
  const dir = mkdtempSync(join(TMP, 'p-'));
  writeFileSync(join(dir, 'chatcops.config.mjs'), body);
  write(dir, files);
  return dir;
}

function write(dir: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

async function run(args: string[], cwd: string, env: Record<string, string> = {}) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, { stdout: { write: (t: string) => (stdout += t) }, stderr: { write: (t: string) => (stderr += t) }, cwd, env });
  return { code, stdout, stderr };
}

const cassetteOf = (dir: string) => join(dir, 'evals', '__cassettes__', 'pricing.chat.jsonl');
const entries = (dir: string) =>
  readFileSync(cassetteOf(dir), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));

describe('chatcops test --record and --replay', () => {
  it('records each call, then replays them without the network', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    const recorded = await run(['test', '--record'], dir);
    expect(recorded.code).toBe(EXIT.ok);
    expect(recorded.stderr).toContain('Recording API calls.');
    expect(recorded.stderr).toContain(`Saved ${join('evals', '__cassettes__', 'pricing.chat.jsonl')}`);
    expect(hits).toHaveLength(3);
    expect(hits[0].auth).toBe('Bearer sk-secret-header');

    const saved = readFileSync(cassetteOf(dir), 'utf8');
    expect(saved).not.toContain('sk-secret');
    expect(entries(dir).map((e) => e.test)).toEqual(['price', 'hello', 'hello']);
    expect(entries(dir)[0]).toMatchObject({
      request: { method: 'POST', url: `${modelUrl}/v1/chat?v=1`, body: { system: 'You are a test bot.' } },
      response: { status: 200, contentType: 'application/json' },
    });

    hits = [];
    const replayed = await run(['test', '--replay'], dir);
    expect(replayed.stderr).toContain('Replaying recorded API calls. Run with --record to update them.');
    expect(replayed.stdout).toContain('2 passed, 0 failed.');
    expect(replayed.code).toBe(EXIT.ok);
    expect(hits).toHaveLength(0);
  });

  it('replays by default when CI is set, and --live overrides it', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    await run(['test', '--record'], dir);
    hits = [];
    const ci = await run(['test'], dir, { CI: 'true' });
    expect(ci.stderr).toContain('(CI is set)');
    expect(ci.code).toBe(EXIT.ok);
    expect(hits).toHaveLength(0);
    await run(['test', '--live'], dir, { CI: 'true' });
    expect(hits).toHaveLength(3);
    hits = [];
    await run(['test'], dir, { CI: 'false' });
    expect(hits).toHaveLength(3);
    expect(existsSync(join(dir, 'evals', '__cassettes__'))).toBe(true);
  });

  it('fails a test whose calls changed, and says where', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    await run(['test', '--record'], dir);
    writeFileSync(join(dir, 'chatcops.config.mjs'), config('You are a test bot!'));
    // A new file, so Node doesn't reuse the cached config module.
    writeFileSync(join(dir, 'changed.config.mjs'), config('You are a test bot!'));
    const { code, stdout } = await run(['test', '--replay', '--config', 'changed.config.mjs'], dir);
    expect(code).toBe(EXIT.problems);
    expect(stdout).toContain(`A call changed since it was recorded (POST ${modelUrl}/v1/chat?v=1, at system). Run chatcops test --record to record it again.`);
    expect(stdout).toContain('0 passed, 2 failed.');
    expect(hits).toHaveLength(3);
  });

  it('fails on calls that were never recorded', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    const none = await run(['test', '--replay'], dir);
    expect(none.stdout).toContain(`There's no recording for this eval file (${cassetteOf(dir)}). Run chatcops test --record to make one.`);
    expect(none.code).toBe(EXIT.problems);

    await run(['test', '--record'], dir);
    write(dir, { 'evals/pricing.chat.yaml': PRICING.replace('      - user: hi again', '      - user: hi again\n      - user: and again') });
    const more = await run(['test', '--replay', '--filter', 'hello', '--json'], dir);
    const result = JSON.parse(more.stdout).results[0].runs[0];
    expect(result.error).toBe(`The test made a call that wasn't made when it was recorded (POST ${modelUrl}/v1/chat?v=1). Run chatcops test --record to record it again.`);
    expect(result.turns).toHaveLength(3);
  });

  it('records each repeat in order, and replays them in order', async () => {
    const coin = `version: 1
name: Pricing
tests:
  - name: coin
    repeat: 2
    passRate: 0
    turns:
      - user: flip
`;
    const dir = project({ 'evals/pricing.chat.yaml': coin });
    const recorded = await run(['test', '--record', '--json'], dir);
    const said = JSON.parse(recorded.stdout).results[0].runs.map((r: { turns: Array<{ turn: { text: string } }> }) => r.turns[0].turn.text);
    expect(entries(dir)).toHaveLength(2);
    expect(entries(dir)[0].key).toBe(entries(dir)[1].key);
    const replayed = await run(['test', '--replay', '--json'], dir);
    expect(JSON.parse(replayed.stdout).results[0].runs.map((r: { turns: Array<{ turn: { text: string } }> }) => r.turns[0].turn.text)).toEqual(said);
    const third = await run(['test', '--replay', '--repeat', '3', '--json'], dir);
    expect(JSON.parse(third.stdout).results[0].runs[2].error).toContain("wasn't made when it was recorded");
  });

  it('re-records only the tests that ran, and drops tests that are gone', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    await run(['test', '--record'], dir);
    const before = entries(dir);
    await run(['test', '--record', '--filter', 'price'], dir);
    expect(entries(dir)).toEqual(before);
    expect(hits).toHaveLength(4);

    write(dir, { 'evals/pricing.chat.yaml': PRICING.slice(0, PRICING.indexOf('  - name: hello')) });
    await run(['test', '--record'], dir);
    expect(entries(dir).map((e) => e.test)).toEqual(['price']);
  });

  it('keeps error and empty responses as they were', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING }, config(undefined, '/down'));
    const live = await run(['test', '--record', '--json'], dir);
    expect(entries(dir)[0].response).toEqual({ status: 503, contentType: 'application/json', body: '{"error":"overloaded"}' });
    const replayed = await run(['test', '--replay', '--json'], dir);
    expect(JSON.parse(replayed.stdout).failed).toBe(2);
    expect(JSON.parse(replayed.stdout).results[0].runs[0].error).toBe(JSON.parse(live.stdout).results[0].runs[0].error);

    const cassettes = new Cassettes('record');
    const uninstall = cassettes.install();
    try {
      const { value } = await cassettes.run('/x/a.chat.yaml', 't', async () => (await fetch(`${modelUrl}/empty`, { method: 'POST' })).status);
      expect(value).toBe(204);
    } finally {
      uninstall();
    }
    expect(globalThis.fetch).not.toBe(undefined);
  });

  it('saves big responses gzipped and replays them exactly', async () => {
    const recorder = new Cassettes('record');
    let uninstall = recorder.install();
    const fixture = join(TMP, 'big', 'a.chat.yaml');
    let live = '';
    try {
      ({ value: live } = await recorder.run(fixture, 't', async () => (await fetch(`${modelUrl}/big`, { method: 'POST' })).text()));
    } finally {
      uninstall();
    }
    await recorder.save([{ path: fixture, ran: ['t'], all: ['t'] }]);
    const [entry] = readFileSync(cassettePath(fixture), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    expect(live.length).toBeGreaterThan(4096);
    expect(entry.response.encoding).toBe('gzip');
    expect(entry.response.body.length).toBeLessThan(live.length / 3);

    hits = [];
    const replayer = new Cassettes('replay');
    await replayer.load([fixture]);
    uninstall = replayer.install();
    try {
      const { value } = await replayer.run(fixture, 't', async () => (await fetch(`${modelUrl}/big`, { method: 'POST' })).text());
      expect(value).toBe(live);
    } finally {
      uninstall();
    }
    expect(hits).toHaveLength(0);
  });

  it('refuses two modes at once and a broken cassette', async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING });
    const both = await run(['test', '--record', '--replay'], dir);
    expect(both.stderr).toContain('Pick one of --record, --replay.');
    expect(both.code).toBe(EXIT.unusable);
    write(dir, { 'evals/__cassettes__/pricing.chat.jsonl': '{"test":\n' });
    const broken = await run(['test', '--replay'], dir);
    expect(broken.stderr).toContain("pricing.chat.jsonl:1 isn't valid JSON");
    expect(broken.code).toBe(EXIT.unusable);
  });

  it('replays without API keys for the built-in providers', async () => {
    const keyless = `export default { server: { systemPrompt: 'x', provider: { type: 'claude', apiKey: process.env.NO_SUCH_KEY } } };`;
    const dir = project({ 'evals/pricing.chat.yaml': PRICING }, keyless);
    const { stdout } = await run(['test', '--replay', '--json'], dir);
    const error = JSON.parse(stdout).results[0].runs[0].error;
    expect(error).toContain("There's no recording for this eval file");
    expect(error).not.toContain('apiKey');
    const live = await run(['test', '--live'], dir);
    expect(live.stderr).toContain("The server config's provider can't start: claude requires apiKey");
    expect(live.code).toBe(EXIT.unusable);
  });

  it("doesn't find eval files inside __cassettes__", async () => {
    const dir = project({ 'evals/pricing.chat.yaml': PRICING, 'evals/__cassettes__/old.chat.yaml': 'not: an eval' });
    expect((await run(['test', 'evals/**/*.chat.yaml'], dir)).code).toBe(EXIT.ok);
  });
});

describe('cassette helpers', () => {
  it('names the cassette after the eval file', () => {
    expect(cassettePath(join(TMP, 'evals', 'pricing.chat.yaml'))).toBe(join(TMP, 'evals', '__cassettes__', 'pricing.chat.jsonl'));
    expect(cassettePath(join(TMP, 'evals', 'a.chat.mjs'))).toBe(join(TMP, 'evals', '__cassettes__', 'a.chat.jsonl'));
  });

  it('hashes requests the same whatever the key order, and drops secrets from the URL', async () => {
    const a = await describeRequest(new Request('https://x.test/v1?api_key=s&key=s&token=t&model=m', { method: 'POST', body: '{"a":1,"b":{"c":2,"d":3}}' }));
    const b = await describeRequest(new Request('https://x.test/v1?model=m', { method: 'POST', body: '{"b":{"d":3,"c":2},"a":1}' }));
    expect(a.url).toBe('https://x.test/v1?model=m');
    expect(hashRequest(a)).toBe(hashRequest(b));
    expect(hashRequest(a)).not.toBe(hashRequest({ ...b, body: { a: 2 } }));
    expect(await describeRequest(new Request('https://x.test/', { method: 'POST', body: 'plain text' }))).toMatchObject({ body: 'plain text' });
    expect(await describeRequest(new Request('https://x.test/'))).toEqual({ method: 'GET', url: 'https://x.test/' });
  });

  it('finds where two bodies first differ', () => {
    expect(firstDifference({ a: 1, m: [{ c: 'x' }, { c: 'y' }] }, { a: 1, m: [{ c: 'x' }, { c: 'z' }] })).toBe('m[1].c');
    expect(firstDifference({ a: 1 }, { a: 1, b: 2 })).toBe('b');
    expect(firstDifference([1], [1, 2])).toBe('[1]');
    expect(firstDifference('a', 'b')).toBe('(root)');
    expect(firstDifference({ a: [1] }, { a: [1] })).toBeUndefined();
  });

  it('passes calls made outside a test straight through', async () => {
    const cassettes = new Cassettes('replay');
    const uninstall = cassettes.install();
    try {
      const res = await fetch(`${modelUrl}/v1/chat`, { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
      expect(await res.json()).toEqual({ text: 'Hello!' });
    } finally {
      uninstall();
    }
  });
});
