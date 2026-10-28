import { consoleLogger, type Logger } from '@chatcops/core';
/**
 * Startup checks for the security settings the server is about to add: the
 * allowed origins and the secrets that sign session tokens.
 *
 * These are the mistakes that fail silently. A secret that is ten characters
 * long works, and so does a secret that is also a `NEXT_PUBLIC_` variable, so
 * nothing breaks until the day it does. A function that finds them before the
 * server starts is worth more than one that finds them during a request.
 *
 * Nothing here logs or throws. The caller decides what to do with a problem.
 */

/** The security settings a server is configured with. */
export interface SecuritySettings {
  /** The origins the server accepts requests from. `*` allows every origin. */
  allowedOrigins?: string[];
  /** The secrets that sign session tokens. */
  sessionSecrets?: string[];
}

/** One thing that is wrong with the security settings. */
export interface SecurityProblem {
  /** An error stops the server from starting. A warning is worth a look. */
  level: 'error' | 'warning';
  /** What is wrong, and what to do about it. Never contains a secret. */
  message: string;
}

/** How many bytes a session secret needs to be worth signing with. */
const MIN_SECRET_BYTES = 32;

/**
 * The env var prefixes whose value is shipped to the browser, so a secret
 * that shares a value with one of them is in the client bundle.
 */
const PUBLIC_ENV_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'PUBLIC_', 'NUXT_PUBLIC_', 'EXPO_PUBLIC_', 'REACT_APP_'];

/**
 * The environment to read, which is `process.env` where there is one. Workers
 * have no `process`, so the checks still work there with an empty environment.
 */
function defaultEnv(): Record<string, string | undefined> {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
}

/** How many bytes a string takes in UTF-8, so a 32 byte secret is 32 bytes. */
function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Finds the mistakes in the security settings, most serious first.
 *
 * `env` is the environment to look in, and defaults to `process.env`.
 */
export function checkSecuritySettings(
  settings: SecuritySettings,
  env?: Record<string, string | undefined>,
): SecurityProblem[] {
  const problems: SecurityProblem[] = [];
  const secrets = settings.sessionSecrets ?? [];
  const origins = settings.allowedOrigins ?? [];
  const environment = env ?? defaultEnv();

  for (const [index, secret] of secrets.entries()) {
    if (utf8Length(secret) < MIN_SECRET_BYTES) {
      problems.push({
        level: 'error',
        message: `Session secret ${index + 1} is shorter than ${MIN_SECRET_BYTES} bytes.`,
      });
    }
  }

  for (const [index, secret] of secrets.entries()) {
    for (const name of Object.keys(environment)) {
      if (!PUBLIC_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
      if (environment[name] !== secret) continue;
      problems.push({
        level: 'error',
        message:
          `Session secret ${index + 1} is also the value of the ${name} environment variable, ` +
          'which is sent to the browser. Use a different secret.',
      });
    }
  }

  for (const [index, secret] of secrets.entries()) {
    const first = secrets.indexOf(secret);
    if (first !== index) {
      problems.push({
        level: 'warning',
        message: `Session secrets ${first + 1} and ${index + 1} are the same.`,
      });
    }
  }

  for (const origin of origins) {
    if (origin === '*') continue;
    if (!origin.startsWith('http://') && !origin.startsWith('https://')) {
      problems.push({
        level: 'error',
        message: `Allowed origin "${origin}" must start with http:// or https://.`,
      });
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      problems.push({
        level: 'error',
        message: `Allowed origin "${origin}" is not a valid URL.`,
      });
      continue;
    }
    if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '' || /[/?#]$/.test(origin)) {
      problems.push({
        level: 'error',
        message:
          `Allowed origin "${origin}" must not have a path, a query, a fragment or a trailing slash, ` +
          `because browsers send the origin without one. Use "${parsed.origin}".`,
      });
      continue;
    }
    if (origin.startsWith('http://') && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
      problems.push({
        level: 'warning',
        message: `Allowed origin "${origin}" uses http://. Use https://, unless it is a local development server.`,
      });
    }
  }

  if (origins.includes('*') && origins.length > 1) {
    problems.push({
      level: 'warning',
      message: 'Allowed origins include "*", which allows every site, so the other entries do nothing.',
    });
  }

  return problems;
}

/** What a server's security settings come to, for the startup log. */
export interface SecuritySummary {
  allowedOrigins: string[];
  /** Seconds, when session tokens are on. */
  sessionTtlSec?: number;
  requireSession?: boolean;
  turnstile: boolean;
}

/** The one line the server logs at startup about its security settings. */
export function describeSecurity(summary: SecuritySummary): string {
  const origins = summary.allowedOrigins.includes('*')
    ? 'any site (allowedOrigins is "*"; list your sites in production)'
    : summary.allowedOrigins.join(', ');
  const sessions =
    summary.sessionTtlSec === undefined
      ? 'session tokens off'
      : `session tokens on (${summary.sessionTtlSec}s${summary.requireSession === false ? ', not required' : ''})`;
  return `Security: chat allowed from ${origins}; ${sessions}; Turnstile ${summary.turnstile ? 'on' : 'off'}.`;
}

/** Logs the problems `checkSecuritySettings` finds, errors first, then the summary line. */
export function logSecurityAtStartup(
  settings: SecuritySettings & Omit<SecuritySummary, 'allowedOrigins'>,
  logger: Logger = consoleLogger()
): void {
  const allowedOrigins = settings.allowedOrigins ?? ['*'];
  const problems = checkSecuritySettings({ ...settings, allowedOrigins });
  for (const problem of problems.filter((p) => p.level === 'error')) logger.error('insecure_config', `ERROR: ${problem.message}`);
  for (const problem of problems.filter((p) => p.level === 'warning')) logger.warn('insecure_config', problem.message);
  logger.info('security', describeSecurity({ ...settings, allowedOrigins }));
}
