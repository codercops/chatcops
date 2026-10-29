# @chatcops/cli public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/cli`

```ts
export type Assertion = Record<string, unknown>;

export type AssertionCheck = (value: unknown, turn: TurnResult, conversation: TurnResult[], context: AssertionContext) => Promise<CheckResult> | CheckResult;

export interface AssertionResult {
    assertion: Assertion;
    pass: boolean;
    score?: number;
    reason?: string;
    costUsd?: number;
}

export declare const ASSERTIONS: Map<string, AssertionCheck>;

export interface ChatCopsCliConfig {
    embedder?: Embedder;
    storage?: ChatCopsStorage;
    store?: VectorStore;
    manifest?: KeyValueStore;
    ingest?: Omit<IngestConfig, 'embedder' | 'store' | 'manifest' | 'onEvent' | 'dryRun' | 'force' | 'prune'>;
    server?: ChatCopsServerConfig;
    judge?: ProviderConfig | AIProvider;
    prices?: Prices;
}

export declare const CONFIG_FILES: string[];

export declare class ConfigError extends Error {
    constructor(message: string);
}

export declare function defineConfig(config: ChatCopsCliConfig): ChatCopsCliConfig;

export declare const EXIT: {
    readonly ok: 0;
    readonly problems: 1;
    readonly unusable: 2;
};

export declare function findFixtures(cwd: string, patterns: string[]): Promise<string[]>;

export interface Fixture {
    version: 1;
    name: string;
    defaults?: Partial<Omit<TestCase, 'name' | 'turns'>>;
    tests: TestCase[];
}

export interface Io {
    stdout: {
        write(text: string): unknown;
    };
    stderr: {
        write(text: string): unknown;
    };
    cwd: string;
    env?: Record<string, string | undefined>;
}

export declare function loadConfig(cwd: string, path?: string): Promise<LoadedConfig>;

export interface LoadedConfig {
    file: string;
    config: ChatCopsCliConfig;
    close(): Promise<void>;
}

export declare function loadFixture(file: string): Promise<Fixture>;

export declare function main(argv: string[], io: Io): Promise<number>;

export interface Reporter {
    onResult?(result: TestResult): void;
    onEnd?(results: TestResult[], summary: RunSummary): void | Promise<void>;
}

export type ReporterFactory = (output: ReporterOutput, options: {
    env?: Record<string, string | undefined>;
    verbose?: boolean;
}) => Reporter;

export interface ReporterOutput {
    write(text: string): unknown;
}

export declare const REPORTERS: Map<string, ReporterFactory>;

export declare function runFixtures(server: ChatCopsServerConfig | undefined, fixtures: FixtureJob[], options?: RunOptions): Promise<TestResult[]>;

export interface RunOptions {
    concurrency?: number;
    repeat?: number;
    onResult?: (result: TestResult) => void;
    cassettes?: Cassettes;
    judge?: Judge;
    model?: string;
    prices?: Prices;
    spend?: Spend;
}

export interface TestCase {
    name: string;
    tags?: string[];
    locale?: string;
    pageContext?: PageContext;
    userData?: Record<string, string>;
    mocks?: {
        tools?: Record<string, ToolResult>;
    };
    turns: Turn[];
    repeat?: number;
    passRate?: number;
}

export interface TestResult {
    fixture: string;
    test: string;
    runs: TestRunResult[];
    passRate: number;
    pass: boolean;
    durationMs?: number;
}

export interface TestRunResult {
    fixture: string;
    test: string;
    run: number;
    pass: boolean;
    turns: Array<{
        results: AssertionResult[];
        turn: TurnResult;
    }>;
    error?: string;
}

export declare function toSource(value: string, baseUrl: string | undefined, cwd: string): IngestSource;

export interface Turn {
    user: string;
    expect?: Assertion[];
}

export interface TurnResult {
    user: string;
    text: string;
    toolCalls: Array<{
        input: unknown;
        name: string;
    }>;
    sources: Array<{
        title?: string;
        url: string;
    }>;
    leads: Array<Record<string, unknown>>;
    finishReason?: string;
    usage?: {
        inputTokens: number;
        outputTokens: number;
    };
    latencyMs: number;
    error?: string;
    model?: string;
    costUsd?: number;
}
```

## Types no entry exports

They're part of the API above all the same: a change to one is a change to the API.

```ts
interface AssertionContext {
    fixture: string;
    judge?: Judge;
}

type CassetteMode = 'live' | 'record' | 'replay';

declare class Cassettes {
    readonly mode: CassetteMode;
    constructor(mode: CassetteMode);
    install(): () => void;
    load(fixtures: string[]): Promise<void>;
    run<T>(fixture: string, test: string, fn: () => Promise<T>): Promise<{
        problems: string[];
        value: T;
    }>;
    save(fixtures: Array<{
        all: string[];
        path: string;
        ran: string[];
    }>): Promise<string[]>;
}

type CheckResult = AssertionResult | Omit<AssertionResult, 'assertion'>;

interface FixtureJob {
    file: string;
    path?: string;
    fixture: Fixture;
    tests: TestCase[];
}

interface Judge {
    id: string;
    model?: string;
    grade(rubric: string, conversation: TurnResult[]): Promise<{
        costUsd?: number;
        reason: string;
        score: number;
    }>;
}

interface PageContext {
    url: string;
    title: string;
    description?: string;
    contentSnippet?: string;
}

type Prices = Record<string, {
    input: number;
    output: number;
}>;

interface RunSummary {
    mode: CassetteMode;
    model?: string;
    elapsedMs: number;
    costIncomplete: boolean;
    judge?: string;
    costUsd?: number;
}

declare class Spend {
    readonly max: number | undefined;
    spent: number;
    constructor(max: number | undefined, counting: boolean);
    add(costUsd: number | undefined): void;
    get exceeded(): boolean;
}
```
