# @chatcops/store-redis public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/store-redis`

```ts
export declare const DEFAULT_CONVERSATION_TTL_MS: number;

export declare const DEFAULT_PREFIX = "chatcops";

export declare function fromIoRedis(redis: IoRedisLike): RedisLike;

export interface IoRedisLike {
    eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>;
    get(key: string): Promise<string | null>;
    set(key: string, value: unknown, ...args: unknown[]): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
    quit?(): Promise<unknown>;
    disconnect?(): void;
}

export declare class RedisConversationStore implements ConversationStore {
    constructor(redis: RedisLike, prefix: string, ttlMs: number);
    get(id: string): Promise<Conversation | null>;
    save(conversation: Conversation): Promise<void>;
    append(id: string, messages: ChatMessage[], options?: AppendOptions): Promise<{
        version: number;
    }>;
    updateMessage(id: string, message: ChatMessage): Promise<boolean>;
    removeMessage(id: string, messageId: string): Promise<boolean>;
    delete(id: string): Promise<void>;
    list(query: ListQuery): Promise<{
        items: ConversationSummary[];
        cursor?: string;
    }>;
    purge(before: number): Promise<number>;
}

export declare class RedisCounterStore implements CounterStore {
    constructor(redis: RedisLike, prefix: string);
    increment(key: string, by: number, ttlMs: number): Promise<CounterValue>;
    get(key: string): Promise<CounterValue | null>;
}

export declare class RedisEventSink implements EventSink {
    constructor(redis: RedisLike, prefix: string, ttlMs?: number);
    write(events: AnalyticsEvent[]): Promise<void>;
    query(query: EventQuery): Promise<EventCount[]>;
}

export declare class RedisKeyValueStore implements KeyValueStore {
    constructor(redis: RedisLike, prefix: string);
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, options?: {
        ttlMs?: number;
    }): Promise<void>;
    setIfAbsent(key: string, value: unknown, options?: {
        ttlMs?: number;
    }): Promise<boolean>;
    delete(key: string): Promise<void>;
}

export interface RedisLike {
    eval<TArgs extends unknown[] = unknown[], TData = unknown>(script: string, keys: string[], args: TArgs): Promise<TData>;
    get<T = unknown>(key: string): Promise<T | null>;
    set(key: string, value: unknown, opts?: RedisSetOptions): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
    quit?(): Promise<unknown>;
    close?(): Promise<unknown>;
    disconnect?(): void;
}

export interface RedisSetOptions {
    px?: number;
    nx?: boolean;
    ex?: number;
    xx?: boolean;
    keepttl?: boolean;
    [key: string]: unknown;
}

export declare function redisStorage(options: RedisStorageOptions): ChatCopsStorage;

export interface RedisStorageOptions {
    redis: RedisLike;
    prefix?: string;
    conversationTtlMs?: number;
}
```
