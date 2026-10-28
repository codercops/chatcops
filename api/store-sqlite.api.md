# @chatcops/store-sqlite public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/store-sqlite`

```ts
export type ExtraColumns = string[] | Record<string, string>;

export interface RowHookContext {
    table: 'conversations' | 'messages';
    conversationId: string;
    metadata?: Record<string, unknown>;
    message?: ChatMessage;
}

export type RowHookFunction = (context: RowHookContext) => Record<string, unknown>;

export interface SqliteDatabase {
    prepare(sql: string): SqliteStatement;
    exec(sql: string): void;
    close?(): void;
    loadExtension?(path: string): void;
}

export declare function sqliteStorage(options: SqliteStorageOptions): ChatCopsStorage;

export interface SqliteStorageOptions {
    vectors?: {
        dimensions: number;
    };
    path?: string;
    database?: SqliteDatabase;
    extraColumns?: ExtraColumns;
    rowHook?: RowHookFunction;
}
```

## Types no entry exports

They're part of the API above all the same: a change to one is a change to the API.

```ts
interface SqliteStatement {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
}
```
