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

/** A second model plays the visitor from a persona, until a stop condition. */
export interface Simulate {
  persona: string;
  /** 1 to 20 visitor messages. */
  maxTurns: number;
  /** Ends the conversation once the bot has done this. */
  stopWhen?: 'lead-captured';
}

export interface TestCase {
  name: string;
  tags?: string[];
  locale?: string;
  pageContext?: PageContext;
  userData?: Record<string, string>;
  /** Server tools answered with a fixed result instead of running. */
  mocks?: { tools?: Record<string, ToolResult> };
  /** Fixed messages. A test has either `turns` or `simulate`. */
  turns?: Turn[];
  simulate?: Simulate;
  /** For `simulate`: checked once, on the last turn, with the whole conversation. */
  expect?: Assertion[];
  /** Run the test this many times. Default 1. */
  repeat?: number;
  /** Share of repeats that must pass. Default 1 (all of them). */
  passRate?: number;
}

export interface Fixture {
  version: 1;
  name: string;
  /** Test defaults; a test's own values win, and `mocks.tools` are merged. */
  defaults?: Partial<Omit<TestCase, 'name' | 'turns' | 'simulate' | 'expect'>>;
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
  /** The bot's model id, when the provider says. */
  model?: string;
  /** What the turn cost in US dollars, from `prices` in the config. Unset when the model has no price. */
  costUsd?: number;
  /** The visitor's message came from a simulated visitor. */
  simulated?: boolean;
  /** What the simulated visitor's messages for this turn cost, in US dollars. Unset when the judge model has no price. */
  visitorCostUsd?: number;
}

export interface AssertionResult {
  assertion: Assertion;
  pass: boolean;
  score?: number;
  reason?: string;
  /** What checking cost (a judge's call), in US dollars. */
  costUsd?: number;
}

/** What an assertion can use besides the turn. */
export interface AssertionContext {
  /** The eval file, on disk. */
  fixture: string;
  /** The judge, when the run uses `judge` assertions. */
  judge?: Judge;
}

/** Grades a reply against a rubric with a model, and plays simulated visitors. */
export interface Judge {
  /** `provider:model`, printed with every run that uses it. */
  id: string;
  model?: string;
  grade(rubric: string, conversation: TurnResult[]): Promise<{ score: number; reason: string; costUsd?: number }>;
  /** Plays the visitor of a `simulate` test: its next message, or `DONE` when its goal is reached. */
  play(persona: string, conversation: TurnResult[]): Promise<{ message: string; costUsd?: number }>;
}

type CheckResult = AssertionResult | Omit<AssertionResult, 'assertion'>;

/** Checks one turn. Registered by the assertion's key (`contains`). */
export type AssertionCheck = (value: unknown, turn: TurnResult, conversation: TurnResult[], context: AssertionContext) => Promise<CheckResult> | CheckResult;

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
  durationMs?: number;
}
