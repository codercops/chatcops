import { runStorageConformance } from '@chatcops/core/testing';
import pg from 'pg';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { fromPostgresJs, migrate, migrateVectors, postgresStorage, tableNames } from '../src/index.js';
import { PostgresVectorStore } from '../src/vectors.js';

const url = process.env.CHATCOPS_TEST_POSTGRES_URL;

if (url) {
  it('supports filtered vector reads through postgres.js', async () => {
    const sql = postgres(url, { max: 2, onnotice: () => {} });
    const db = fromPostgresJs(sql);
    const tablePrefix = `conformance_${Date.now().toString(36)}_`;
    const table = tableNames(tablePrefix).vectorChunks;
    try {
      await migrateVectors(db, { dimensions: 4, tablePrefix });
      const vectors = new PostgresVectorStore(4, db, table);
      await vectors.upsert([
        {
          id: `${tablePrefix}chunk`,
          vector: new Float32Array([1, 0, 0, 0]),
          text: 'Postgres.js vector query',
          source: { id: `${tablePrefix}source`, url: 'https://example.test' },
          metadata: { locale: 'en' },
        },
      ]);
      expect(await vectors.query({ vector: new Float32Array([1, 0, 0, 0]), topK: 1 })).toHaveLength(1);
      expect(await vectors.query({ vector: new Float32Array([1, 0, 0, 0]), topK: 1, filter: { locale: 'en' } })).toHaveLength(1);
    } finally {
      await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      await sql.end();
    }
  });

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
