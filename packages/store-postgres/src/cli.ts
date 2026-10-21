import type { Queryable } from './queryable.js';
import { migrate } from './schema.js';

export const USAGE = `Usage: chatcops-postgres migrate [--prefix chatcops_]

Creates or updates the ChatCops tables in the database at DATABASE_URL.
Needs the pg package installed.`;

export interface CliDeps {
  env: Record<string, string | undefined>;
  log(message: string): void;
  error(message: string): void;
  /** Opens a pool for the URL. Defaults to `pg`. */
  connect?(url: string): Promise<Queryable & { end(): Promise<void> }>;
}

async function connectWithPg(url: string) {
  const pg = await import('pg').catch(() => null);
  if (!pg) throw new Error('The migrate command needs the pg package: npm install pg');
  return new pg.default.Pool({ connectionString: url });
}

/** The `chatcops-postgres` command. Resolves the exit code. */
export async function main(args: string[], deps: CliDeps): Promise<number> {
  if (args[0] !== 'migrate') {
    deps.log(USAGE);
    return args[0] === '--help' || args[0] === '-h' ? 0 : 1;
  }

  const prefixIndex = args.indexOf('--prefix');
  const tablePrefix = prefixIndex === -1 ? undefined : args[prefixIndex + 1];
  const url = deps.env.DATABASE_URL;
  if (!url) {
    deps.error('Set DATABASE_URL to the database to migrate.');
    return 1;
  }

  let pool: Queryable & { end(): Promise<void> };
  try {
    pool = await (deps.connect ?? connectWithPg)(url);
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  try {
    const { applied } = await migrate(pool, { tablePrefix });
    deps.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Already up to date.');
    return 0;
  } catch (error) {
    // Only the message: driver errors can include the connection string.
    deps.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await pool.end();
  }
}
