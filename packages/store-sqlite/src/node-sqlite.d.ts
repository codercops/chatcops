declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string);
    prepare(sql: string): {
      run(...params: unknown[]): unknown;
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    };
    exec(sql: string): void;
    close(): void;
  }
}
