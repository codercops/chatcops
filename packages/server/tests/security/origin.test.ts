import { describe, expect, it } from 'vitest';
import { corsHeaders, matchOrigin } from '../../src/security/origin.js';

describe('matchOrigin', () => {
  it('matches every origin with a wildcard, including missing origins', () => {
    for (const origin of ['https://example.com', null, '', 'null']) {
      expect(matchOrigin(origin, ['*'])).toBe('*');
    }
  });

  it('matches exact origins case-insensitively and ignores a trailing slash', () => {
    expect(matchOrigin('HTTPS://ACME.COM', ['https://acme.com/'])).toBe('https://acme.com/');
  });

  it('requires the exact scheme, host, and port for exact entries', () => {
    expect(matchOrigin('https://acme.com', ['https://acme.com'])).toBe('https://acme.com');
    expect(matchOrigin('http://acme.com', ['https://acme.com'])).toBeNull();
    expect(matchOrigin('https://acme.com:8443', ['https://acme.com'])).toBeNull();
  });

  it('matches one or more wildcard subdomain labels', () => {
    const allowed = ['https://*.acme.com'];
    expect(matchOrigin('https://app.acme.com', allowed)).toBe(allowed[0]);
    expect(matchOrigin('https://a.b.acme.com', allowed)).toBe(allowed[0]);
  });

  it('does not match the apex domain or an unbounded hostname suffix', () => {
    const allowed = ['https://*.acme.com'];
    expect(matchOrigin('https://acme.com', allowed)).toBeNull();
    expect(matchOrigin('https://evilacme.com', allowed)).toBeNull();
  });

  it('requires the same scheme and port for wildcard subdomains', () => {
    const allowed = ['https://*.acme.com:8443'];
    expect(matchOrigin('https://app.acme.com:8443', allowed)).toBe(allowed[0]);
    expect(matchOrigin('https://app.acme.com', allowed)).toBeNull();
    expect(matchOrigin('https://app.acme.com:443', allowed)).toBeNull();
    expect(matchOrigin('http://app.acme.com:8443', allowed)).toBeNull();
  });

  it('only matches null-like origins with a wildcard', () => {
    for (const origin of [null, '', 'null']) {
      expect(matchOrigin(origin, ['https://acme.com'])).toBeNull();
    }
  });
});

describe('corsHeaders', () => {
  it('returns a wildcard header without Vary for exactly ["*"]', () => {
    expect(corsHeaders('https://example.com', ['*'])).toEqual({
      'Access-Control-Allow-Origin': '*',
    });
  });

  it('returns the request origin and Vary for a concrete match', () => {
    expect(corsHeaders('https://app.acme.com', ['https://*.acme.com'])).toEqual({
      'Access-Control-Allow-Origin': 'https://app.acme.com',
      Vary: 'Origin',
    });
  });

  it('omits allow-origin but keeps Vary when nothing matches', () => {
    expect(corsHeaders('https://evil.example.com', ['https://acme.com'])).toEqual({ Vary: 'Origin' });
  });

  it('keeps Vary when wildcard is combined with other entries', () => {
    expect(corsHeaders('https://example.com', ['*', 'https://acme.com'])).toEqual({
      'Access-Control-Allow-Origin': '*',
      Vary: 'Origin',
    });
  });
});
