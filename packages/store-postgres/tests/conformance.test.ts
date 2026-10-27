import { runStorageConformance } from '@chatcops/core/testing';
import pg from 'pg';
import postgres from 'postgres';
import { describe } from 'vitest';
import { fromPostgresJs, migrate, migrateVectors, postgresStorage } from '../src/index.js';

const url = process.env.CHATCOPS_TEST_POSTGRES_URL;

if (url) {
  // Through node-postgres, which most people use.
  runStorageConformance('postgres (pg)', async () => {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    await migrate(pool);
    await migrateVectors(pool, { dimensions: 4 });
    return { ...postgresStorage({ db: pool, dimensions: 4 }), close: () => pool.end() };
  });

  // And through postgres.js, which returns rows differently.
  runStorageConformance('postgres (postgres.js)', async () => {
    const sql = postgres(url, { max: 10, onnotice: () => {} });
    const db = fromPostgresJs(sql);
    await migrate(db);
    await migrateVectors(db, { dimensions: 4 });
    return { ...postgresStorage({ db, dimensions: 4 }), close: () => sql.end() };
  });
} else {
  describe.skip('postgres conformance (set CHATCOPS_TEST_POSTGRES_URL to run)', () => {});
}
