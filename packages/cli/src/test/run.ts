import { randomUUID } from 'node:crypto';
import { isAIProvider, memoryStorage, type ChatTool, type ToolResult, type WirePart } from '@chatcops/core';
import { createChatHandler, type ChatCopsServerConfig } from '@chatcops/server';
import { ConfigError } from '../config.js';
import { check } from './assertions/index.js';
import type { Cassettes } from './cassette.js';
import { costOf, dollars, type Prices, type Spend } from './cost.js';
import type { Fixture, Judge, TestCase, TestResult, TestRunResult, TurnResult } from './types.js';

export interface RunOptions {
  /** Tests run at once. Default 4. */
  concurrency?: number;
  /** Overrides each test's `repeat`. */
  repeat?: number;
  /** Called as each test finishes. */
  onResult?: (result: TestResult) => void;
  /** Records or replays each test's HTTP calls. */
  cassettes?: Cassettes;
  /** For `judge` assertions. */
  judge?: Judge;
  /** The bot's model id, to price its turns. */
  model?: string;
  prices?: Prices;
  /** Stops starting turns once `--max-cost` is reached. */
  spend?: Spend;
}

interface RemoteOptions {
  url: string;
  headers: Headers;
}

/** An eval file to run: `file` as reported, `path` on disk (for its cassette). */
export interface FixtureJob {
  file: string;
  path?: string;
  fixture: Fixture;
  tests: TestCase[];
}

/**
 * Runs every test of the fixtures against the server config, in process: the
 * real request path (knowledge, page context, locale, tools), with fresh
 * in-memory storage for every run and the fixture's tool mocks.
 */
export async function runFixtures(
  server: ChatCopsServerConfig | undefined,
  fixtures: FixtureJob[],
  options: RunOptions = {}
): Promise<TestResult[]> {
  return runFixturesWithTransport(server, fixtures, options);
}

/** CLI-only URL transport; kept outside the package's public entry point. */
export async function runRemoteFixtures(
  server: ChatCopsServerConfig | undefined,
  fixtures: FixtureJob[],
  remote: RemoteOptions,
  options: RunOptions = {}
): Promise<TestResult[]> {
  return runFixturesWithTransport(server, fixtures, { ...options, remote });
}

interface InternalRunOptions extends RunOptions {
  remote?: RemoteOptions;
}

async function runFixturesWithTransport(
  server: ChatCopsServerConfig | undefined,
  fixtures: FixtureJob[],
  options: InternalRunOptions
): Promise<TestResult[]> {
  if (!options.remote && options.cassettes?.mode === 'replay' && server) server = withoutKeys(server);
  const jobs = fixtures.flatMap(({ file, path, tests }) => tests.map((test) => ({ file, path: path ?? file, test })));
  const results: TestResult[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const { file, path, test } = jobs[index];
      const started = performance.now();
      results[index] = await runTest(file, test, options.repeat, (run) => {
        const once = () => runOnce(server, { file, path, test, run }, options);
        if (!options.cassettes) return once();
        return options.cassettes.run(path, test.name, once).then(({ value, problems }) => {
          if (problems.length) {
            value.pass = false;
            value.error = problems.length > 1 ? `${problems[0]} (and ${problems.length - 1} more)` : problems[0];
          }
          return value;
        });
      });
      results[index].durationMs = performance.now() - started;
      options.onResult?.(results[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, options.concurrency ?? 4), jobs.length) }, worker));
  return results;
}

async function runTest(
  fixture: string,
  test: TestCase,
  repeatOverride: number | undefined,
  once: (run: number) => Promise<TestRunResult>
): Promise<TestResult> {
  const repeat = repeatOverride ?? test.repeat ?? 1;
  const runs: TestRunResult[] = [];
  for (let run = 1; run <= repeat; run++) runs.push(await once(run));
  const passed = runs.filter((result) => result.pass).length;
  const passRate = passed / runs.length;
  return { fixture, test: test.name, runs, passRate, pass: passRate >= (test.passRate ?? 1) };
}

async function runOnce(
  server: ChatCopsServerConfig | undefined,
  { file, path, test, run }: { file: string; path: string; test: TestCase; run: number },
  options: InternalRunOptions
): Promise<TestRunResult> {
  const result: TestRunResult = { fixture: file, test: test.name, run, pass: true, turns: [] };
  const { spend } = options;
  const context = { fixture: path, ...(options.judge ? { judge: options.judge } : {}) };
  // Usage on `finish` is what usage assertions read.
  const handler = server && !options.remote
    ? createChatHandler({ ...server, exposeUsage: true, storage: memoryStorage(), tools: withMocks(server.tools ?? [], test.mocks?.tools) })
    : undefined;
  let conversationId = `eval-${randomUUID()}`;
  const conversation: TurnResult[] = [];

  for (const turnSpec of test.turns) {
    if (spend?.exceeded) {
      result.pass = false;
      result.error = `stopped before turn ${conversation.length + 1}: --max-cost ${dollars(spend.max ?? 0)} reached (${dollars(spend.spent)} spent)`;
      break;
    }
    const body = {
      conversationId,
      message: turnSpec.user,
      ...(test.locale ? { locale: test.locale } : {}),
      ...(test.pageContext ? { pageContext: test.pageContext } : {}),
      ...(test.userData ? { userData: test.userData } : {}),
    };
    const sent = options.remote
      ? await sendRemoteTurn(options.remote, conversationId, body)
      : { turn: await sendTurn(handler!, body), conversationId };
    const turn = sent.turn;
    conversationId = sent.conversationId;
    if (options.model) turn.model = options.model;
    const costUsd = costOf(options.model, turn.usage, options.prices);
    if (costUsd !== undefined) turn.costUsd = costUsd;
    spend?.add(costUsd);
    conversation.push(turn);
    const checks = [];
    for (const assertion of turnSpec.expect ?? []) {
      const checked = await check(assertion, turn, conversation, context);
      spend?.add(checked.costUsd);
      checks.push(checked);
    }
    result.turns.push({ turn, results: checks });
    if (checks.some((c) => !c.pass)) result.pass = false;
    if (turn.error) {
      result.pass = false;
      result.error = `turn ${conversation.length} failed: ${turn.error}`;
      break;
    }
  }
  return result;
}

/** Sends one message and collects the reply's parts as a turn result. */
export async function sendTurn(handler: ReturnType<typeof createChatHandler>, body: Record<string, unknown>): Promise<TurnResult> {
  const started = performance.now();
  const turn: TurnResult = { user: String(body.message), text: '', toolCalls: [], sources: [], leads: [], latencyMs: 0 };
  const start = await handler.startChat(body, undefined, { format: 'v1' });
  if (!start.ok) {
    turn.error = start.error.message ? `${start.error.code}: ${start.error.message}` : start.error.code;
    turn.latencyMs = performance.now() - started;
    return turn;
  }
  try {
    for await (const part of start.parts as AsyncIterable<WirePart>) {
      if (part.type === 'text-delta') turn.text += part.delta;
      else if (part.type === 'tool-call') turn.toolCalls.push({ name: part.toolName, input: part.input });
      else if (part.type === 'source') turn.sources.push({ url: part.url, ...(part.title ? { title: part.title } : {}) });
      else if (part.type === 'lead-captured') turn.leads.push(part.lead as Record<string, unknown>);
      else if (part.type === 'error') turn.error = part.code;
      else if (part.type === 'finish') {
        turn.finishReason = part.reason;
        if (part.usage) turn.usage = { inputTokens: part.usage.inputTokens, outputTokens: part.usage.outputTokens };
        turn.latencyMs = performance.now() - started;
      }
    }
  } catch (error) {
    // The server's HTTP layer turns this into an internal_error part; in
    // process it arrives as a throw, such as a knowledge source that failed.
    // It fails this test instead of stopping the whole run.
    turn.error = `internal_error: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!turn.latencyMs) turn.latencyMs = performance.now() - started;
  return turn;
}

/** Sends a protocol v1 request and parses the response into the eval turn shape. */
export async function sendRemoteTurn(
  remote: RemoteOptions,
  conversationId: string,
  body: Record<string, unknown>
): Promise<{ turn: TurnResult; conversationId: string }> {
  const started = performance.now();
  const turn: TurnResult = { user: String(body.message), text: '', toolCalls: [], sources: [], leads: [], latencyMs: 0 };
  let currentConversationId = conversationId;
  try {
    const headers = new Headers(remote.headers);
    headers.set('content-type', 'application/json');
    const response = await fetch(remote.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, protocol: 1 }),
    });
    if (!response.ok) {
      turn.error = `http_${response.status}: Remote server refused the request.`;
      return { turn: finishLatency(turn, started), conversationId: currentConversationId };
    }
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      throw new RemoteProtocolError('expected a text/event-stream response');
    }
    if (response.headers.get('x-chatcops-protocol') !== '1') {
      throw new RemoteProtocolError('response did not identify ChatCops protocol v1');
    }
    if (!response.body) throw new RemoteProtocolError('response had no stream body');

    let startedStream = false;
    let finished = false;
    let done = false;
    for await (const data of eventData(response.body)) {
      if (done) throw new RemoteProtocolError('data followed the terminal marker');
      if (data === '[DONE]') {
        if (!finished) throw new RemoteProtocolError('stream ended before the finish part');
        done = true;
        continue;
      }
      let part: unknown;
      try {
        part = JSON.parse(data);
      } catch {
        throw new RemoteProtocolError('an event was not valid JSON');
      }
      if (!part || typeof part !== 'object' || typeof (part as { type?: unknown }).type !== 'string') {
        throw new RemoteProtocolError('an event was not a protocol part');
      }
      const wire = part as Record<string, unknown>;
      if (!startedStream && wire.type !== 'start') throw new RemoteProtocolError('the first part was not start');
      if (wire.type === 'start') {
        if (startedStream || wire.protocol !== 1 || typeof wire.conversationId !== 'string' || !wire.conversationId) {
          throw new RemoteProtocolError('the start part was invalid');
        }
        startedStream = true;
        currentConversationId = wire.conversationId;
      } else if (wire.type === 'text-delta') {
        if (typeof wire.delta !== 'string') throw new RemoteProtocolError('a text-delta part had no text');
        turn.text += wire.delta;
      } else if (wire.type === 'tool-call') {
        if (typeof wire.toolName !== 'string' || !('input' in wire)) throw new RemoteProtocolError('a tool-call part was invalid');
        turn.toolCalls.push({ name: wire.toolName, input: wire.input });
      } else if (wire.type === 'source') {
        if (typeof wire.url !== 'string') throw new RemoteProtocolError('a source part was invalid');
        turn.sources.push({ url: wire.url, ...(typeof wire.title === 'string' ? { title: wire.title } : {}) });
      } else if (wire.type === 'lead-captured') {
        if (!wire.lead || typeof wire.lead !== 'object' || Array.isArray(wire.lead)) throw new RemoteProtocolError('a lead-captured part was invalid');
        turn.leads.push(wire.lead as Record<string, unknown>);
      } else if (wire.type === 'error') {
        if (typeof wire.code !== 'string') throw new RemoteProtocolError('an error part had no code');
        turn.error = wire.code;
      } else if (wire.type === 'finish') {
        if (typeof wire.reason !== 'string' || finished) throw new RemoteProtocolError('the finish part was invalid');
        finished = true;
        turn.finishReason = wire.reason;
        if (wire.usage && typeof wire.usage === 'object') {
          const usage = wire.usage as { inputTokens?: unknown; outputTokens?: unknown };
          if (typeof usage.inputTokens === 'number' && typeof usage.outputTokens === 'number') {
            turn.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
          }
        }
        turn.latencyMs = performance.now() - started;
      } else if (finished) {
        throw new RemoteProtocolError('a part followed the finish part');
      }
    }
    if (!startedStream || !finished || !done) throw new RemoteProtocolError('stream ended unexpectedly');
  } catch (error) {
    turn.error = error instanceof RemoteProtocolError
      ? `protocol_error: ${error.message}`
      : 'network_error: The request to the remote server failed.';
  }
  return { turn: finishLatency(turn, started), conversationId: currentConversationId };
}

class RemoteProtocolError extends Error {}

function finishLatency(turn: TurnResult, started: number): TurnResult {
  if (!turn.latencyMs) turn.latencyMs = performance.now() - started;
  return turn;
}

async function* eventData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      while (true) {
        const boundary = /\r?\n\r?\n/.exec(buffer);
        if (!boundary) break;
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''));
        if (data.length) yield data.join('\n');
      }
      if (done) break;
    }
    if (buffer.trim()) throw new RemoteProtocolError('the final event was not terminated');
  } finally {
    reader.releaseLock();
  }
}

/** The config's tools, with mocked ones answering their fixed result instead of running. */
export function withMocks(tools: ChatTool[], mocks: Record<string, ToolResult> | undefined): ChatTool[] {
  if (!mocks || !Object.keys(mocks).length) return tools;
  const names = new Set(tools.map((tool) => tool.name));
  const unknown = Object.keys(mocks).filter((name) => !names.has(name));
  if (unknown.length) throw new ConfigError(`Mocks for tools the server config doesn't have: ${unknown.join(', ')}`);
  return tools.map((tool) =>
    mocks[tool.name] ? Object.assign(Object.create(tool) as ChatTool, { execute: async () => structuredClone(mocks[tool.name]) }) : tool
  );
}

/**
 * In replay nothing reaches the network, so CI needs no keys. The built-in
 * providers refuse to start without one, so give them a stand-in. Headers
 * aren't part of what a recording is matched on.
 */
export function withoutKeys(server: ChatCopsServerConfig): ChatCopsServerConfig {
  const { provider } = server;
  if (isAIProvider(provider) || provider.apiKey?.trim()) return server;
  return { ...server, provider: { ...provider, apiKey: 'chatcops-replay' } };
}
