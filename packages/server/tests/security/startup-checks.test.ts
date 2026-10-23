import { afterEach, describe, it, expect, vi } from 'vitest';
import { scriptedProvider } from '@chatcops/core/testing/provider';
import { checkSecuritySettings, describeSecurity } from '../../src/security/startup-checks.js';

const LONG_SECRET = 'a-secret-that-is-at-least-32-bytes-long';

describe('checkSecuritySettings', () => {
  it('says nothing about a clean configuration', () => {
    const problems = checkSecuritySettings(
      { allowedOrigins: ['https://acme.com'], sessionSecrets: [LONG_SECRET] },
      {},
    );
    expect(problems).toEqual([]);
  });

  it('says nothing when there is nothing to check', () => {
    expect(checkSecuritySettings({}, {})).toEqual([]);
  });

  it('reports a session secret shorter than 32 bytes', () => {
    const problems = checkSecuritySettings({ sessionSecrets: ['short'] }, {});
    expect(problems).toEqual([
      { level: 'error', message: 'Session secret 1 is shorter than 32 bytes.' },
    ]);
  });

  it('counts the bytes of a secret, not its characters', () => {
    // 16 two-byte characters are 32 bytes, so this one is long enough.
    const problems = checkSecuritySettings({ sessionSecrets: ['é'.repeat(16)] }, {});
    expect(problems).toEqual([]);
  });

  it('reports a secret that is also a public environment variable', () => {
    const problems = checkSecuritySettings(
      { sessionSecrets: [LONG_SECRET] },
      { NEXT_PUBLIC_SESSION_SECRET: LONG_SECRET },
    );
    expect(problems).toEqual([
      {
        level: 'error',
        message:
          'Session secret 1 is also the value of the NEXT_PUBLIC_SESSION_SECRET environment variable, ' +
          'which is sent to the browser. Use a different secret.',
      },
    ]);
  });

  it('reports a secret for every public environment variable prefix', () => {
    for (const prefix of ['NEXT_PUBLIC_', 'VITE_', 'PUBLIC_', 'NUXT_PUBLIC_', 'EXPO_PUBLIC_', 'REACT_APP_']) {
      const problems = checkSecuritySettings(
        { sessionSecrets: [LONG_SECRET] },
        { [`${prefix}KEY`]: LONG_SECRET },
      );
      expect(problems).toHaveLength(1);
      expect(problems[0].message).toContain(`${prefix}KEY`);
    }
  });

  it('ignores a private environment variable with the same value', () => {
    const problems = checkSecuritySettings(
      { sessionSecrets: [LONG_SECRET] },
      { SESSION_SECRET: LONG_SECRET },
    );
    expect(problems).toEqual([]);
  });

  it('never puts the secret in a message', () => {
    const secret = 'thirty-two-bytes-exactly-long-ok';
    const problems = checkSecuritySettings(
      { sessionSecrets: [secret] },
      { NEXT_PUBLIC_KEY: secret },
    );
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.message).not.toContain(secret);
    }
  });

  it('reports two session secrets that are the same', () => {
    const problems = checkSecuritySettings({ sessionSecrets: [LONG_SECRET, LONG_SECRET] }, {});
    expect(problems).toEqual([
      { level: 'warning', message: 'Session secrets 1 and 2 are the same.' },
    ]);
  });

  it('reports an allowed origin that is not a URL', () => {
    const problems = checkSecuritySettings({ allowedOrigins: ['acme.com'] }, {});
    expect(problems).toEqual([
      { level: 'error', message: 'Allowed origin "acme.com" must start with http:// or https://.' },
    ]);
  });

  it('reports an allowed origin that is not a valid URL', () => {
    const problems = checkSecuritySettings({ allowedOrigins: ['https://'] }, {});
    expect(problems).toEqual([
      { level: 'error', message: 'Allowed origin "https://" is not a valid URL.' },
    ]);
  });

  it('reports an allowed origin with a path, a query, a fragment or a trailing slash, and says what to use', () => {
    const problems = checkSecuritySettings(
      { allowedOrigins: ['https://acme.com/app', 'https://acme.com/?a=1', 'https://acme.com/', 'https://acme.com#top', 'https://acme.com?'] },
      {},
    );
    expect(problems).toHaveLength(5);
    for (const problem of problems) {
      expect(problem.level).toBe('error');
      expect(problem.message).toContain('must not have a path, a query, a fragment or a trailing slash');
      expect(problem.message).toContain('Use "https://acme.com".');
    }
  });

  it('accepts subdomain wildcards and ports', () => {
    expect(checkSecuritySettings({ allowedOrigins: ['https://*.acme.com', 'https://acme.com:8443'] }, {})).toEqual([]);
  });

  it('allows a plain http:// origin on localhost', () => {
    const problems = checkSecuritySettings(
      { allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:8080'] },
      {},
    );
    expect(problems).toEqual([]);
  });

  it('warns about an http:// origin that is not local', () => {
    const problems = checkSecuritySettings({ allowedOrigins: ['http://acme.com'] }, {});
    expect(problems).toEqual([
      {
        level: 'warning',
        message: 'Allowed origin "http://acme.com" uses http://. Use https://, unless it is a local development server.',
      },
    ]);
  });

  it('warns when "*" is used together with other origins', () => {
    const problems = checkSecuritySettings({ allowedOrigins: ['*', 'https://acme.com'] }, {});
    expect(problems).toEqual([
      { level: 'warning', message: 'Allowed origins include "*", which allows every site, so the other entries do nothing.' },
    ]);
  });

  it('allows "*" on its own', () => {
    expect(checkSecuritySettings({ allowedOrigins: ['*'] }, {})).toEqual([]);
  });

  it('reads the environment from process.env when none is given', () => {
    const secret = 'a-secret-that-is-at-least-32-bytes-long';
    process.env.NEXT_PUBLIC_CHECK_SECRET = secret;
    try {
      const problems = checkSecuritySettings({ sessionSecrets: [secret] });
      expect(problems).toHaveLength(1);
      expect(problems[0].message).toContain('NEXT_PUBLIC_CHECK_SECRET');
    } finally {
      delete process.env.NEXT_PUBLIC_CHECK_SECRET;
    }
  });
});

describe('the startup log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sums up the settings in one line', () => {
    expect(describeSecurity({ allowedOrigins: ['*'], turnstile: false })).toBe(
      '[chatcops] Security: chat allowed from any site (allowedOrigins is "*"; list your sites in production); session tokens off; Turnstile off.'
    );
    expect(describeSecurity({ allowedOrigins: ['https://acme.com', 'https://*.acme.com'], sessionTtlSec: 900, requireSession: false, turnstile: true })).toBe(
      '[chatcops] Security: chat allowed from https://acme.com, https://*.acme.com; session tokens on (900s, not required); Turnstile on.'
    );
  });

  it('logs errors, then warnings, then the summary, once per process', async () => {
    vi.resetModules();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { createChatHandler } = await import('../../src/handler.js');
    const config = {
      provider: scriptedProvider([]),
      systemPrompt: 'x',
      budgets: false as const,
      allowedOrigins: ['acme.com', 'http://staging.acme.com'],
      sessionSecrets: ['a-session-secret-that-is-long-enough-1'],
    };

    createChatHandler(config).cleanup();
    createChatHandler(config).cleanup();

    expect(error.mock.calls).toEqual([['[chatcops] ERROR: Allowed origin "acme.com" must start with http:// or https://.']]);
    expect(warn.mock.calls).toEqual([
      ['[chatcops] Allowed origin "http://staging.acme.com" uses http://. Use https://, unless it is a local development server.'],
    ]);
    expect(info.mock.calls.filter(([line]) => String(line).startsWith('[chatcops] Security:'))).toEqual([
      ['[chatcops] Security: chat allowed from acme.com, http://staging.acme.com; session tokens on (900s); Turnstile off.'],
    ]);
  });
});
