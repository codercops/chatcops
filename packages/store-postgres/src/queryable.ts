/**
 * Anything that runs a parameterized query and returns rows. A `pg` `Pool`
 * or `Client` fits as is. Filtered vector searches use an optional transaction
 * callback, or acquire a connection from a `pg` Pool.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs the callback on one transaction-bound connection when supported. */
  transaction?<T>(run: (db: Queryable) => Promise<T>): Promise<T>;
}

/** The part of a postgres.js `sql` instance the store uses. */
export interface PostgresJsSql {
  unsafe(text: string, params?: never[]): PromiseLike<unknown>;
  begin?<T>(run: (sql: PostgresJsSql) => Promise<T>): Promise<T>;
}

/** Wraps a postgres.js client: `fromPostgresJs(postgres(url))`. */
export function fromPostgresJs(sql: PostgresJsSql): Queryable {
  const db: Queryable = {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = (await sql.unsafe(text, params as never[])) as T[];
      return { rows: [...rows] };
    },
  };
  const begin = sql.begin;
  if (begin) {
    db.transaction = async <T>(run: (db: Queryable) => Promise<T>) =>
      (await begin.call(sql, (tx) => run(fromPostgresJs(tx)))) as T;
  }
  return db;
}

/** The part of a Neon serverless `sql` function the store uses. */
export interface NeonSql {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

/** Wraps the Neon serverless driver: `fromNeon(neon(process.env.DATABASE_URL))`. */
export function fromNeon(sql: NeonSql): Queryable {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const result = await sql.query(text, params);
      const rows = Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? []);
      return { rows: rows as T[] };
    },
  };
}
