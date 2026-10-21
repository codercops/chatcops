import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { main, USAGE } from '../src/cli.js';

const url = process.env.CHATCOPS_TEST_POSTGRES_URL;

function deps(env: Record<string, string | undefined> = {}, connect?: () => Promise<never>) {
  return { env, log: vi.fn(), error: vi.fn(), ...(connect ? { connect } : {}) };
}

describe('chatcops-postgres', () => {
  it('prints usage for anything but migrate', async () => {
    const help = deps();
    expect(await main(['--help'], help)).toBe(0);
    expect(help.log).toHaveBeenCalledWith(USAGE);
    expect(await main([], deps())).toBe(1);
  });

  it('needs DATABASE_URL', async () => {
    const d = deps();
    expect(await main(['migrate'], d)).toBe(1);
    expect(d.error).toHaveBeenCalledWith('Set DATABASE_URL to the database to migrate.');
  });

  it('reports a connection that fails to open', async () => {
    const d = deps({ DATABASE_URL: 'postgres://nowhere' }, async () => {
      throw new Error('The migrate command needs the pg package: npm install pg');
    });
    expect(await main(['migrate'], d)).toBe(1);
    expect(d.error).toHaveBeenCalledWith('The migrate command needs the pg package: npm install pg');
  });

  it('reports a failed migration without the connection details', async () => {
    const end = vi.fn(async () => {});
    const d = {
      ...deps({ DATABASE_URL: 'postgres://user:secret@db/app' }),
      connect: async () => ({ query: async () => Promise.reject(new Error('permission denied')), end }),
    };
    expect(await main(['migrate'], d)).toBe(1);
    expect(d.error).toHaveBeenCalledWith('Migration failed: permission denied');
    expect(end).toHaveBeenCalled();
  });

  it.runIf(url)('migrates the database, then has nothing to do', async () => {
    const prefix = `cli${Date.now().toString(36)}_`;
    const first = deps({ DATABASE_URL: url });
    expect(await main(['migrate', '--prefix', prefix], first)).toBe(0);
    expect(first.log).toHaveBeenCalledWith('Applied migrations: 1');
    const second = deps({ DATABASE_URL: url });
    expect(await main(['migrate', '--prefix', prefix], second)).toBe(0);
    expect(second.log).toHaveBeenCalledWith('Already up to date.');

    const pool = new pg.Pool({ connectionString: url });
    const { rows } = await pool.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE tablename LIKE $1", [`${prefix}%`]);
    for (const { tablename } of rows) await pool.query(`DROP TABLE IF EXISTS ${tablename} CASCADE`);
    await pool.end();
  });
});
