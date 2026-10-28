# @chatcops/store-postgres public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/store-postgres`

```ts
export type ExtraColumns = string[] | Record<string, string>;

export declare function fromNeon(sql: NeonSql): Queryable;

export declare function fromPostgresJs(sql: PostgresJsSql): Queryable;

export declare function migrate(db: Queryable, options?: MigrateOptions): Promise<{
    applied: number[];
}>;

export interface MigrateOptions {
    tablePrefix?: string;
}

export declare function migrateVectors(db: Queryable, options: MigrateVectorsOptions): Promise<void>;

export interface MigrateVectorsOptions {
    dimensions: number;
    tablePrefix?: string;
}

export declare const MIGRATIONS: Migration[];

export interface NeonSql {
    query(text: string, params?: unknown[]): Promise<unknown>;
}

export declare class PostgresConversationStore implements ConversationStore {
    constructor(db: Queryable, t: TableNames, now: () => number, hook?: RowHook | undefined);
    get(id: string): Promise<Conversation | null>;
    save(conversation: Conversation): Promise<void>;
    delete(id: string): Promise<void>;
    append(id: string, messages: ChatMessage[], options?: AppendOptions): Promise<{
        version: number;
    }>;
    updateMessage(id: string, message: ChatMessage): Promise<boolean>;
    removeMessage(id: string, messageId: string): Promise<boolean>;
    list(query: ListQuery): Promise<{
        items: ConversationSummary[];
        cursor?: string;
    }>;
    purge(before: number): Promise<number>;
}

export declare class PostgresCounterStore implements CounterStore {
    constructor(db: Queryable, t: TableNames, now: () => number);
    increment(key: string, by: number, ttlMs: number): Promise<CounterValue>;
    get(key: string): Promise<CounterValue | null>;
}

export declare class PostgresEventSink implements EventSink {
    constructor(db: Queryable, t: TableNames);
    write(events: AnalyticsEvent[]): Promise<void>;
    query(query: EventQuery): Promise<EventCount[]>;
}

export interface PostgresJsSql {
    unsafe(text: string, params?: never[]): PromiseLike<unknown>;
    begin?<T>(run: (sql: PostgresJsSql) => Promise<T>): Promise<T>;
}

export declare class PostgresKeyValueStore implements KeyValueStore {
    constructor(db: Queryable, t: TableNames, now: () => number);
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options?: {
        ttlMs?: number;
    }): Promise<void>;
    setIfAbsent(key: string, value: unknown, options?: {
        ttlMs?: number;
    }): Promise<boolean>;
    delete(key: string): Promise<void>;
}

export declare function postgresStorage(options: PostgresStorageOptions): ChatCopsStorage;

export interface PostgresStorageOptions {
    db: Queryable;
    tablePrefix?: string;
    dimensions?: number;
    extraColumns?: ExtraColumns;
    rowHook?: RowHookFunction;
    now?: () => number;
}

export declare class PostgresVectorStore implements VectorStore {
    readonly dimensions: number;
    constructor(dimensions: number, db: Queryable, table: string);
    upsert(records: VectorRecord[]): Promise<void>;
    query({ vector, topK, filter }: VectorQuery): Promise<ScoredRecord[]>;
    keywordQuery({ text, topK, filter }: KeywordQuery): Promise<ScoredRecord[]>;
    deleteBySource(sourceId: string): Promise<void>;
}

export interface Queryable {
    query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{
        rows: T[];
    }>;
    transaction?<T>(run: (db: Queryable) => Promise<T>): Promise<T>;
}

export interface RowHookContext {
    table: 'conversations' | 'messages';
    conversationId: string;
    metadata?: Record<string, unknown>;
    message?: ChatMessage;
}

export type RowHookFunction = (context: RowHookContext) => Record<string, unknown>;

export declare function tableNames(prefix?: string): TableNames;

export interface TableNames {
    conversations: string;
    messages: string;
    counters: string;
    kv: string;
    events: string;
    migrations: string;
    vectorChunks: string;
}
```

## Types no entry exports

They're part of the API above all the same: a change to one is a change to the API.

```ts
interface Migration {
    id: number;
    name: string;
    statements(t: TableNames): string[];
}

interface RowHook {
    columns: Array<[
        name: string,
        type: string
    ]>;
    columnList: string;
    values(context: RowHookContext): Record<string, unknown>;
}
```
