import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '@chatcops/core';
import { scriptedProvider, textStep } from '@chatcops/core/testing/provider';
import { createChatHandler } from '@chatcops/server';
import { EXIT, main } from '../src/index.js';

const TMP = resolve(__dirname, '.tmp-remote');
let servers: Array<() => Promise<void>> = [];

beforeAll(() => mkdirSync(TMP, { recursive: true }));
afterAll(async () => {
  await Promise.all(servers.map((close) => close()));
  rmSync(TMP, { recursive: true, force: true });
});

function project(yaml: string): string {
  const dir = mkdtempSync(join(TMP, 'eval-'));
  const file = join(dir, 'evals', 'remote', 'test.chat.yaml');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, yaml);
  return dir;
}

async function run(args: string[], cwd: string) {
  let stdout = '';
  let stderr = '';
  const code = await main(args, {
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
    cwd,
    env: {},
  });
  return { code, stdout, stderr };
}

interface SeenRequest {
  body: Record<string, unknown>;
  authorization?: string;
  testHeader?: string;
}

async function chatServer(script: Parameters<typeof scriptedProvider>[0], beforeHandle?: (req: SeenRequest, res: import('node:http').ServerResponse) => boolean) {
  const provider = scriptedProvider(script);
  const handler = createChatHandler({ provider, systemPrompt: 'Reply briefly.', storage: memoryStorage(), exposeUsage: true });
  const requests: SeenRequest[] = [];
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      const seen = { body, authorization: incoming.headers.authorization, testHeader: incoming.headers['x-test'] as string | undefined };
      requests.push(seen);
      if (beforeHandle?.(seen, outgoing)) return;
      void (async () => {
        const start = await handler.startChat(body, undefined, { format: 'v1', authorization: incoming.headers.authorization });
        if (!start.ok) {
          outgoing.writeHead(start.status, { 'content-type': 'application/json' });
          outgoing.end(JSON.stringify({ error: start.error }));
          return;
        }
        outgoing.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'x-chatcops-protocol': '1' });
        for await (const part of start.parts) outgoing.write(`data: ${JSON.stringify(part)}\n\n`);
        outgoing.end('data: [DONE]\n\n');
      })();
    });
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/chat`;
  const close = () => new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  servers.push(close);
  return { server, url, requests, provider, close };
}

function fixture(tests: string): string {
  return `version: 1\nname: Remote\ntests:\n${tests}`;
}

function json(stdout: string) {
  return JSON.parse(stdout) as {
    results: Array<{ runs: Array<{ turns: Array<{ turn: { text: string; conversationId?: string; finishReason?: string; usage?: unknown; error?: string } }> }> }>;
  };
}

describe('chatcops test --url', () => {
  it('sends protocol v1 requests, parses streamed turns and reuses the server conversation id', async () => {
    const remote = await chatServer([textStep('Hello'), textStep('We remember you.')]);
    const dir = project(fixture('  - name: remembers\n    turns:\n      - user: hello\n      - user: what did I ask?\n        expect: [{ contains: remember }]\n'));
    const result = await run(['test', '--url', remote.url, '--json'], dir);
    expect(result.code, `${result.stderr}\n${result.stdout}`).toBe(EXIT.ok);
    expect(remote.requests).toHaveLength(2);
    expect(remote.requests.map((request) => request.body.protocol)).toEqual([1, 1]);
    expect(remote.requests[1].body.conversationId).toBe(remote.requests[0].body.conversationId);
    const turn = json(result.stdout).results[0].runs[0].turns[1].turn;
    expect(turn).toMatchObject({ text: 'We remember you.', finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it('handles an error part as a failed turn', async () => {
    const remote = await chatServer([new Error('provider failed')]);
    const dir = project(fixture('  - name: reports provider error\n    turns: [{ user: hello }]\n'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await run(['test', '--url', remote.url, '--json'], dir);
    errorLog.mockRestore();
    expect(result.code).toBe(EXIT.problems);
    expect(json(result.stdout).results[0].runs[0].turns[0].turn.error).toBe('provider_error');
  });

  it('forwards repeatable headers without exposing their values in a refusal', async () => {
    const secret = 'Bearer do-not-print-this';
    const remote = await chatServer([textStep('unused')], (request, response) => {
      if (request.authorization !== secret) return false;
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'unauthorized', message: secret } }));
      return true;
    });
    const dir = project(fixture('  - name: authenticated\n    turns: [{ user: hello }]\n'));
    const result = await run(['test', '--url', remote.url, '--header', `Authorization: ${secret}`, '--header', 'X-Test: works', '--json'], dir);
    expect(remote.requests[0]).toMatchObject({ authorization: secret });
    expect(remote.requests[0].testHeader).toBe('works');
    expect(result.code).toBe(EXIT.problems);
    expect(result.stdout).toContain('http_401');
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
  });

  it('reports an unavailable remote server without exposing transport details', async () => {
    const dir = project(fixture('  - name: offline\n    turns: [{ user: hello }]\n'));
    const result = await run(['test', '--url', 'http://127.0.0.1:1/chat', '--json'], dir);
    expect(result.code).toBe(EXIT.problems);
    expect(result.stdout).toContain('network_error: The request to the remote server failed.');
  });

  it('rejects a successful response that is not a protocol v1 stream', async () => {
    const server: Server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"text":"wrong format"}');
    });
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/chat`;
    servers.push(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
    const dir = project(fixture('  - name: malformed response\n    turns: [{ user: hello }]\n'));
    const result = await run(['test', '--url', url, '--json'], dir);
    expect(result.code).toBe(EXIT.problems);
    expect(result.stdout).toContain('protocol_error: expected a text/event-stream response');
  });

  it('rejects malformed headers without echoing the supplied value', async () => {
    const dir = project(fixture('  - name: malformed header\n    turns: [{ user: hello }]\n'));
    const result = await run(['test', '--url', 'http://127.0.0.1/chat', '--header', 'Authorization Bearer secret-value'], dir);
    expect(result.code).toBe(EXIT.unusable);
    expect(result.stderr).toContain('--header must use the form');
    expect(result.stderr).not.toContain('secret-value');
  });

  it('rejects tool mocks before sending a remote request', async () => {
    const remote = await chatServer([textStep('unused')]);
    const dir = project(fixture('  - name: mocked\n    mocks:\n      tools:\n        lookup: { success: true }\n    turns: [{ user: hello }]\n'));
    const result = await run(['test', '--url', remote.url], dir);
    expect(result.code).toBe(EXIT.unusable);
    expect(result.stderr).toContain('mocks cannot be used with --url');
    expect(remote.requests).toHaveLength(0);
  });

  it('records and replays the HTTP stream through the existing fetch cassette', async () => {
    const remote = await chatServer([textStep('Recorded answer')]);
    const dir = project(fixture('  - name: recorded\n    turns: [{ user: hello, expect: [{ contains: Recorded }] }]\n'));
    const recorded = await run(['test', '--url', remote.url, '--record', '--json'], dir);
    expect(recorded.code).toBe(EXIT.ok);
    expect(remote.requests).toHaveLength(1);
    await remote.close();
    const replayed = await run(['test', '--url', remote.url, '--replay', '--json'], dir);
    expect(replayed.code, `${replayed.stderr}\n${replayed.stdout}`).toBe(EXIT.ok);
    expect(remote.requests).toHaveLength(1);
    expect(json(replayed.stdout).results[0].runs[0].turns[0].turn.text).toBe('Recorded answer');
  });
});
