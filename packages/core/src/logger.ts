/** Extra details for a log line. An `error` field is printed in full. */
export type LogFields = Record<string, unknown>;

/**
 * Where ChatCops writes what it notices: startup notes, refused requests and
 * every error it catches instead of throwing. `event` is a stable name to
 * filter or alert on (`provider_error`, `tool_error`, `webhook_failed`, …),
 * and `message` is for people.
 */
export interface Logger {
  debug(event: string, message: string, fields?: LogFields): void;
  info(event: string, message: string, fields?: LogFields): void;
  warn(event: string, message: string, fields?: LogFields): void;
  error(event: string, message: string, fields?: LogFields): void;
}

type Level = keyof Logger;
const LEVELS: Level[] = ['debug', 'info', 'warn', 'error'];

/**
 * The default: `[chatcops] message` on the console, with an `error` field
 * printed after it so its stack shows. Other fields are left out, to keep
 * the lines short.
 */
export function consoleLogger(): Logger {
  const write = (level: Level) => (_event: string, message: string, fields?: LogFields) => {
    const line = `[chatcops] ${message}`;
    if (fields?.error !== undefined) console[level](line, fields.error);
    else console[level](line);
  };
  return Object.fromEntries(LEVELS.map((level) => [level, write(level)])) as unknown as Logger;
}

export interface JsonLoggerOptions {
  /** Where each line goes. Default `console.error`, which is stderr on Node and the log on Workers. */
  write?: (line: string) => void;
  /** Lines below this level are dropped. Default `info`. */
  level?: Level;
}

/**
 * One JSON object per line (`{ time, level, event, message, ...fields }`), for
 * log tools that parse them. Errors become `{ name, message, stack }`.
 */
export function jsonLogger(options: JsonLoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => console.error(line));
  const min = LEVELS.indexOf(options.level ?? 'info');
  const log = (level: Level) => (event: string, message: string, fields: LogFields = {}) => {
    if (LEVELS.indexOf(level) < min) return;
    const entries = Object.entries(fields).map(([key, value]) => [key, value instanceof Error ? describeError(value) : value]);
    write(JSON.stringify({ time: new Date().toISOString(), level, event, message, ...Object.fromEntries(entries) }));
  };
  return Object.fromEntries(LEVELS.map((level) => [level, log(level)])) as unknown as Logger;
}

function describeError(error: Error): Record<string, unknown> {
  return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
}

/** A logger that writes nothing, for tests. */
export function silentLogger(): Logger {
  const nothing = () => {};
  return { debug: nothing, info: nothing, warn: nothing, error: nothing };
}
