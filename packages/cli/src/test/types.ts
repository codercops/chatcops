import type { ToolResult } from '@chatcops/core';

/** One assertion, as written in a fixture: `{ contains: "$19" }`. */
export type Assertion = Record<string, unknown>;

export interface PageContext {
  url: string;
  title: string;
  description?: string;
  contentSnippet?: string;
}

export interface Turn {
  user: string;
  expect?: Assertion[];
}

export interface TestCase {
  name: string;
  tags?: string[];
  locale?: string;
  pageContext?: PageContext;
  userData?: Record<string, string>;
  /** Server tools answered with a fixed result instead of running. */
  mocks?: { tools?: Record<string, ToolResult> };
  turns: Turn[];
  /** Run the test this many times. Default 1. */
  repeat?: number;
  /** Share of repeats that must pass. Default 1 (all of them). */
  passRate?: number;
}

export interface Fixture {
  version: 1;
  name: string;
  /** Test defaults; a test's own values win, and `mocks.tools` are merged. */
  defaults?: Partial<Omit<TestCase, 'name' | 'turns'>>;
  tests: TestCase[];
}

/** What a turn produced, as the assertions see it. */
export interface TurnResult {
  user: string;
  /** The reply's text, streamed parts joined. */
  text: string;
  toolCalls: Array<{ name: string; input: unknown }>;
  sources: Array<{ url: string; title?: string }>;
  leads: Array<Record<string, unknown>>;
  finishReason?: string;
  usage?: { inputTokens: number; outputTokens: number };
  /** From the request to the `finish` part. */
  latencyMs: number;
  /** An `error` part's code, when the reply failed. */
  error?: string;
}

export interface AssertionResult {
  assertion: Assertion;
  pass: boolean;
  score?: number;
  reason?: string;
}

/** Checks one turn. Registered by the assertion's key (`contains`). */
export type AssertionCheck = (value: unknown, turn: TurnResult, conversation: TurnResult[]) => Promise<AssertionResult | Omit<AssertionResult, 'assertion'>> | AssertionResult | Omit<AssertionResult, 'assertion'>;

export interface TestRunResult {
  fixture: string;
  test: string;
  /** 1-based, when the test repeats. */
  run: number;
  pass: boolean;
  turns: Array<{ turn: TurnResult; results: AssertionResult[] }>;
  /** When the run couldn't finish: config or provider problems. */
  error?: string;
}

export interface TestResult {
  fixture: string;
  test: string;
  runs: TestRunResult[];
  passRate: number;
  pass: boolean;
}
