/**
 * Anything that runs a parameterized query and returns rows. A `pg` `Pool`
 * or `Client` fits as is. Each query must run on its own: the store never
 * needs a transaction, because every write is a single statement.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/** The part of a postgres.js `sql` instance the store uses. */
export interface PostgresJsSql {
  unsafe(text: string, params?: never[]): PromiseLike<unknown>;
}

/** Wraps a postgres.js client: `fromPostgresJs(postgres(url))`. */
export function fromPostgresJs(sql: PostgresJsSql): Queryable {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = (await sql.unsafe(text, params as never[])) as T[];
      return { rows: [...rows] };
    },
  };
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
