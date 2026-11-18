export interface RedisSetOptions {
  px?: number;
  nx?: boolean;
  ex?: number;
  xx?: boolean;
  keepttl?: boolean;
  [key: string]: unknown;
}

export interface RedisLike {
  eval<TArgs extends unknown[] = unknown[], TData = unknown>(
    script: string,
    keys: string[],
    args: TArgs
  ): Promise<TData>;
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: RedisSetOptions): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  quit?(): Promise<unknown>;
  close?(): Promise<unknown>;
  disconnect?(): void;
}

export interface IoRedisLike {
  eval(script: string, numKeys: number, ...args: unknown[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: unknown, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  quit?(): Promise<unknown>;
  disconnect?(): void;
}

export interface RedisStorageOptions {
  redis: RedisLike;
  prefix?: string;
  conversationTtlMs?: number;
}
