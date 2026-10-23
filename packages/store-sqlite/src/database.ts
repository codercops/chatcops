import { DatabaseSync } from 'node:sqlite';

export interface SqliteStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close?(): void;
}

export type SqliteDatabaseLike = SqliteDatabase;

export function openDatabase(path: string): SqliteDatabase {
  return new DatabaseSync(path) as unknown as SqliteDatabase;
}

export function run<T>(db: SqliteDatabase, sql: string, ...params: unknown[]): T {
  return db.prepare(sql).run(...params) as T;
}

export function get<T>(db: SqliteDatabase, sql: string, ...params: unknown[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function all<T>(db: SqliteDatabase, sql: string, ...params: unknown[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function transaction<T>(db: SqliteDatabase, operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = operation();
    db.exec('COMMIT');
    return value;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve the original error */ }
    throw error;
  }
}
