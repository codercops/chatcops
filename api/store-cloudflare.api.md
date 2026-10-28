# @chatcops/store-cloudflare public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/store-cloudflare`

```ts
export declare class ChatCopsCounter extends BaseDurableObject {
    ctx: DurableObjectState;
    env: unknown;
    increment(by: number, ttlMs: number): Promise<CounterValue>;
    get(): Promise<CounterValue | null>;
    alarm(): Promise<void>;
}

export interface CloudflareBindings {
    DB: D1Database;
    CHATCOPS_VECTORS: VectorizeIndex;
}

export declare function cloudflareStorage(options: CloudflareStorageOptions): ChatCopsStorage;

export interface CloudflareStorageOptions {
    d1: D1Database;
    counters?: DurableObjectNamespace<ChatCopsCounter>;
    extraColumns?: ExtraColumns;
    rowHook?: RowHookFunction;
    now?: () => number;
    vectorize?: VectorizeIndex;
    vectorDimensions?: number;
}

export interface D1Database {
    prepare(query: string): D1PreparedStatement;
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
    exec(query: string): Promise<D1ExecResult>;
}

export interface D1ExecResult {
    count: number;
    duration: number;
}

export interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T = unknown>(colName?: string): Promise<T | null>;
    run<T = unknown>(): Promise<D1Result<T>>;
    all<T = unknown>(): Promise<D1Result<T>>;
    raw<T = unknown>(): Promise<T[]>;
}

export interface D1Result<T = unknown> {
    results: T[];
    success: boolean;
    meta?: {
        duration?: number;
        size_after?: number;
        rows_read?: number;
        rows_written?: number;
        last_row_id?: number;
        changes?: number;
        served_by?: string;
        [key: string]: unknown;
    };
    error?: string;
}

export interface DurableObjectId {
    toString(): string;
    equals(other: DurableObjectId): boolean;
    name?: string;
}

export interface DurableObjectNamespace<T = unknown> {
    newUniqueId(options?: {
        jurisdiction?: string;
    }): DurableObjectId;
    idFromName(name: string): DurableObjectId;
    idFromString(id: string): DurableObjectId;
    get(id: DurableObjectId): DurableObjectStub<T>;
}

export interface DurableObjectState {
    id: DurableObjectId;
    storage: DurableObjectStorage;
    waitUntil(promise: Promise<unknown>): void;
}

export interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
    put<T = unknown>(key: string, value: T): Promise<void>;
    put<T = unknown>(entries: Record<string, T>): Promise<void>;
    delete(key: string): Promise<boolean>;
    delete(keys: string[]): Promise<number>;
    deleteAll(): Promise<void>;
    list<T = unknown>(options?: {
        start?: string;
        startAfter?: string;
        end?: string;
        prefix?: string;
        reverse?: boolean;
        limit?: number;
    }): Promise<Map<string, T>>;
    setAlarm(scheduledTime: number | Date, options?: unknown): Promise<void>;
    getAlarm?(options?: unknown): Promise<number | null>;
    deleteAlarm?(options?: unknown): Promise<void>;
}

export type DurableObjectStub<T = unknown> = {
    id: DurableObjectId;
    name?: string;
} & T;

export type ExtraColumns = string[] | Record<string, string>;

export declare function initializeSchema(db: D1Database): Promise<void>;

export interface RowHookContext {
    table: 'conversations' | 'messages';
    conversationId: string;
    metadata?: Record<string, unknown>;
    message?: ChatMessage;
}

export type RowHookFunction = (context: RowHookContext) => Record<string, unknown>;

export declare const SCHEMA_SQL: string;

export declare const SCHEMA_VERSION = 2;

export interface VectorizeIndex {
    upsert(vectors: Array<{
        id: string;
        values: number[];
        metadata?: Record<string, unknown>;
    }>): Promise<unknown>;
    query(vector: number[] | Float32Array, options: {
        topK: number;
        filter?: Record<string, unknown>;
        returnMetadata?: boolean | 'all' | 'indexed';
    }): Promise<{
        matches?: Array<{
            id: string;
            score?: number;
            metadata?: Record<string, unknown>;
        }>;
    }>;
    deleteByIds(ids: string[]): Promise<unknown>;
}
```

## Types no entry exports

They're part of the API above all the same: a change to one is a change to the API.

```ts
declare const BaseDurableObject: typeof import("cloudflare:workers").DurableObject;
```
