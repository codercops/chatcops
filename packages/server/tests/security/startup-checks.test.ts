import { describe, it, expect } from 'vitest';
import { checkSecuritySettings } from '../../src/security/startup-checks.js';

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
      { level: 'error', message: 'Allowed origin 1 must start with http:// or https://.' },
    ]);
  });

  it('reports an allowed origin that is not a valid URL', () => {
    const problems = checkSecuritySettings({ allowedOrigins: ['https://'] }, {});
    expect(problems).toEqual([
      { level: 'error', message: 'Allowed origin 1 is not a valid URL.' },
    ]);
  });

  it('reports an allowed origin with a path, a query or a trailing slash', () => {
    const problems = checkSecuritySettings(
      { allowedOrigins: ['https://acme.com/app', 'https://acme.com/?a=1', 'https://acme.com/'] },
      {},
    );
    expect(problems).toHaveLength(3);
    for (const problem of problems) {
      expect(problem.level).toBe('error');
      expect(problem.message).toContain('must not have a path, a query or a trailing slash');
    }
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
        message: 'Allowed origin 1 uses http://. Use https://, unless it is a local development server.',
      },
    ]);
  });

  it('warns when "*" is used together with other origins', () => {
    const problems = checkSecuritySettings({ allowedOrigins: ['*', 'https://acme.com'] }, {});
    expect(problems).toEqual([
      { level: 'warning', message: 'Allowed origins include "*", so the other 1 entries do nothing.' },
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
