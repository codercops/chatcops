import { randomUUID } from 'node:crypto';
import { memoryStorage, type ChatTool, type ToolResult, type WirePart } from '@chatcops/core';
import { createChatHandler, type ChatCopsServerConfig } from '@chatcops/server';
import { ConfigError } from '../config.js';
import { check } from './assertions/index.js';
import type { Fixture, TestCase, TestResult, TestRunResult, TurnResult } from './types.js';

export interface RunOptions {
  /** Tests run at once. Default 4. */
  concurrency?: number;
  /** Overrides each test's `repeat`. */
  repeat?: number;
  /** Called as each test finishes. */
  onResult?: (result: TestResult) => void;
}

/**
 * Runs every test of the fixtures against the server config, in process: the
 * real request path (knowledge, page context, locale, tools), with fresh
 * in-memory storage for every run and the fixture's tool mocks.
 */
export async function runFixtures(
  server: ChatCopsServerConfig,
  fixtures: Array<{ file: string; fixture: Fixture; tests: TestCase[] }>,
  options: RunOptions = {}
): Promise<TestResult[]> {
  const jobs = fixtures.flatMap(({ file, tests }) => tests.map((test) => ({ file, test })));
  const results: TestResult[] = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const index = next++;
      const { file, test } = jobs[index];
      results[index] = await runTest(server, file, test, options.repeat);
      options.onResult?.(results[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, options.concurrency ?? 4), jobs.length) }, worker));
  return results;
}

async function runTest(server: ChatCopsServerConfig, fixture: string, test: TestCase, repeatOverride?: number): Promise<TestResult> {
  const repeat = repeatOverride ?? test.repeat ?? 1;
  const runs: TestRunResult[] = [];
  for (let run = 1; run <= repeat; run++) runs.push(await runOnce(server, fixture, test, run));
  const passed = runs.filter((result) => result.pass).length;
  const passRate = passed / runs.length;
  return { fixture, test: test.name, runs, passRate, pass: passRate >= (test.passRate ?? 1) };
}

async function runOnce(server: ChatCopsServerConfig, fixture: string, test: TestCase, run: number): Promise<TestRunResult> {
  const result: TestRunResult = { fixture, test: test.name, run, pass: true, turns: [] };
  // Usage on `finish` is what usage assertions read.
  const handler = createChatHandler({ ...server, exposeUsage: true, storage: memoryStorage(), tools: withMocks(server.tools ?? [], test.mocks?.tools) });
  const conversationId = `eval-${randomUUID()}`;
  const conversation: TurnResult[] = [];

  for (const turnSpec of test.turns) {
    const turn = await sendTurn(handler, {
      conversationId,
      message: turnSpec.user,
      ...(test.locale ? { locale: test.locale } : {}),
      ...(test.pageContext ? { pageContext: test.pageContext } : {}),
      ...(test.userData ? { userData: test.userData } : {}),
    });
    conversation.push(turn);
    const checks = [];
    for (const assertion of turnSpec.expect ?? []) checks.push(await check(assertion, turn, conversation));
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
  if (!turn.latencyMs) turn.latencyMs = performance.now() - started;
  return turn;
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
