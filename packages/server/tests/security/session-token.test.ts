import { describe, expect, it } from 'vitest';
import {
  type SessionClaims,
  type VerifySessionOptions,
  base64UrlDecode,
  base64UrlEncode,
  importSessionKey,
  signSession,
  verifySession,
  verifySessionSignature,
} from '../../src/security/session-token.js';

const VALID_SECRET = '01234567890123456789012345678901'; // 32 ASCII bytes
const ROTATION_SECRET = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 ASCII bytes

const DEFAULT_OPTIONS: VerifySessionOptions = {
  origin: 'https://example.com',
  conversationId: 'conv_456',
};

function validClaims(overrides?: Partial<SessionClaims>): SessionClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    sid: 'sess_123',
    cid: 'conv_456',
    org: 'https://example.com',
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

describe('base64url encoding and decoding', () => {
  it('encodes and decodes bytes without padding', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 16, 32, 64]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 13) & 255;
      if (len === 0) {
        expect(base64UrlEncode(bytes)).toBe('');
        expect(() => base64UrlDecode('')).toThrow();
      } else {
        const encoded = base64UrlEncode(bytes);
        expect(encoded).not.toContain('=');
        expect(encoded).not.toContain('+');
        expect(encoded).not.toContain('/');
        const decoded = base64UrlDecode(encoded);
        expect(Array.from(decoded)).toEqual(Array.from(bytes));
      }
    }
  });

  it('rejects padding characters', () => {
    expect(() => base64UrlDecode('YQ==')).toThrow();
    expect(() => base64UrlDecode('YXE=')).toThrow();
  });

  it('rejects characters outside the base64url alphabet', () => {
    expect(() => base64UrlDecode('a+b=')).toThrow();
    expect(() => base64UrlDecode('a/b_')).toThrow();
    expect(() => base64UrlDecode('ab c')).toThrow();
  });

  it('rejects invalid unpadded lengths (length % 4 === 1)', () => {
    expect(() => base64UrlDecode('a')).toThrow(/length % 4 cannot be 1/);
    expect(() => base64UrlDecode('abcde')).toThrow(/length % 4 cannot be 1/);
  });

  it('rejects non-canonical trailing bits', () => {
    // 'YQ' is 'a' (011000 010000 -> 01100001 = 0x61, lower 4 bits are 0000).
    // If lower 4 bits are non-zero, it should throw.
    expect(() => base64UrlDecode('YR')).toThrow(/non-canonical/);
    expect(() => base64UrlDecode('YWF')).toThrow(/non-canonical/);
  });

  it('rejects characters with code point >= 256', () => {
    expect(() => base64UrlDecode('éabc')).toThrow(/Invalid base64url character/);
    expect(() => base64UrlDecode('abé')).toThrow(/Invalid base64url character/);
    expect(() => base64UrlDecode('aé')).toThrow(/Invalid base64url character/);
  });
});

describe('importSessionKey', () => {
  it('imports an HMAC-SHA256 key from a secret with at least 32 UTF-8 bytes', async () => {
    const key = await importSessionKey(VALID_SECRET);
    expect(key).toBeDefined();
    expect(key.algorithm).toMatchObject({ name: 'HMAC', hash: { name: 'SHA-256' } });
  });

  it('measures UTF-8 byte length for multi-byte characters', async () => {
    // 16 characters of 2 bytes each = 32 UTF-8 bytes
    const multiByteSecret = 'é'.repeat(16);
    expect(multiByteSecret.length).toBe(16);
    expect(new TextEncoder().encode(multiByteSecret).byteLength).toBe(32);
    const key = await importSessionKey(multiByteSecret);
    expect(key).toBeDefined();
  });

  it('accepts a Uint8Array of at least 32 bytes', async () => {
    const bytes = new Uint8Array(32);
    const key = await importSessionKey(bytes);
    expect(key).toBeDefined();
  });

  it('rejects secrets shorter than 32 bytes with a clear error', async () => {
    await expect(importSessionKey('too-short')).rejects.toThrow(
      /Session secret must be at least 32 bytes/
    );
    await expect(importSessionKey('')).rejects.toThrow(/Session secret must be at least 32 bytes/);
    await expect(importSessionKey('1234567890123456789012345678901')).rejects.toThrow(
      /Session secret must be at least 32 bytes \(got 31\)/
    );
    await expect(importSessionKey(new Uint8Array(31))).rejects.toThrow(
      /Session secret must be at least 32 bytes/
    );
  });
});

describe('signSession and verifySession round trip', () => {
  it('signs and verifies a session token successfully', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const claims = validClaims({ uid: 'user_42', tier: 'pro' });

    const token = await signSession(claims, [key]);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const result = await verifySession(token, [key], DEFAULT_OPTIONS);

    expect(result).toEqual({
      ok: true,
      claims: {
        ...claims,
        v: 1,
      },
    });
  });

  it('preserves optional uid and tier claims', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const claims = validClaims({ uid: 'u_1', tier: 'enterprise' });
    const token = await signSession(claims, [key]);
    const result = await verifySession(token, [key], DEFAULT_OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.uid).toBe('u_1');
      expect(result.claims.tier).toBe('enterprise');
    }
  });

  it('throws an error if signSession is called with an empty keys array', async () => {
    await expect(signSession(validClaims(), [])).rejects.toThrow(
      /At least one key is required to sign/
    );
  });

  it('returns bad_signature if verifySession is called with an empty keys array', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims(), [key]);
    expect(await verifySession(token, [], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'bad_signature',
    });
  });

  it('interprets now strictly as seconds and defaults to current time', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims(), [key]);

    const resDefault = await verifySession(token, [key], DEFAULT_OPTIONS);
    expect(resDefault.ok).toBe(true);

    const resSec = await verifySession(token, [key], {
      ...DEFAULT_OPTIONS,
      now: Math.floor(Date.now() / 1000),
    });
    expect(resSec.ok).toBe(true);
  });
});

describe('expiration and clock skew', () => {
  it('rejects an expired token', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const now = 1_700_000_000;
    // Expired 120 seconds ago, beyond default 60s skew
    const claims = validClaims({ iat: now - 3600, exp: now - 120 });
    const token = await signSession(claims, [key]);

    const result = await verifySession(token, [key], { ...DEFAULT_OPTIONS, now });
    expect(result).toEqual({ ok: false, code: 'expired' });
  });

  it('accepts a token within default 60-second clock skew', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const now = 1_700_000_000;
    // Expired 30 seconds ago, within default 60s skew
    const claims = validClaims({ iat: now - 3600, exp: now - 30 });
    const token = await signSession(claims, [key]);

    const result = await verifySession(token, [key], { ...DEFAULT_OPTIONS, now });
    expect(result.ok).toBe(true);
  });

  it('enforces custom clockSkewSec', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const now = 1_700_000_000;
    // Expired 20 seconds ago
    const claims = validClaims({ iat: now - 3600, exp: now - 20 });
    const token = await signSession(claims, [key]);

    // Skew 10 seconds: now (1_700_000_000) - 10 > exp (now - 20) -> expired
    const expired = await verifySession(token, [key], { ...DEFAULT_OPTIONS, now, clockSkewSec: 10 });
    expect(expired).toEqual({ ok: false, code: 'expired' });

    // Skew 30 seconds: now (1_700_000_000) - 30 <= exp (now - 20) -> valid
    const valid = await verifySession(token, [key], { ...DEFAULT_OPTIONS, now, clockSkewSec: 30 });
    expect(valid.ok).toBe(true);
  });
});

describe('signature tampering and altered tokens', () => {
  it('rejects an altered payload with bad_signature', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims(), [key]);
    const [header, payload, sig] = token.split('.');

    // Tamper with payload (change sid to sess_tampered)
    const decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
    decoded.sid = 'sess_tampered';
    const tamperedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(decoded)));

    const tamperedToken = `${header}.${tamperedPayload}.${sig}`;
    const result = await verifySession(tamperedToken, [key], DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, code: 'bad_signature' });
  });

  it('rejects an altered signature with bad_signature', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims(), [key]);
    const [header, payload, sig] = token.split('.');

    // Flip the first character of the signature
    const flippedChar = sig[0] === 'a' ? 'b' : 'a';
    const tamperedSig = `${flippedChar}${sig.slice(1)}`;

    const tamperedToken = `${header}.${payload}.${tamperedSig}`;
    const result = await verifySession(tamperedToken, [key], DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, code: 'bad_signature' });
  });

  it('rejects alg: none with bad_signature', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims(), [key]);
    const [, payload] = token.split('.');

    const noneHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'none', typ: 'JWT' })));
    const noneToken = `${noneHeader}.${payload}.`;
    const result = await verifySession(noneToken, [key], DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, code: 'bad_signature' });

    // With dummy signature
    const dummySig = base64UrlEncode(new Uint8Array(32));
    const noneTokenWithSig = `${noneHeader}.${payload}.${dummySig}`;
    const resultWithSig = await verifySession(noneTokenWithSig, [key], DEFAULT_OPTIONS);
    expect(resultWithSig).toEqual({ ok: false, code: 'bad_signature' });
  });

  it('rejects algorithms other than HS256 with bad_signature', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims(), [key]);
    const [, payload, sig] = token.split('.');

    const rsHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
    const rsToken = `${rsHeader}.${payload}.${sig}`;
    const result = await verifySession(rsToken, [key], DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, code: 'bad_signature' });
  });

  it('validates claims only after signature verification', async () => {
    const key = await importSessionKey(VALID_SECRET);
    // Malformed claims with altered signature must return bad_signature, not malformed
    const badClaimsJson = JSON.stringify({ v: 999, sid: 123 }); // malformed claims
    const badPayloadB64 = base64UrlEncode(new TextEncoder().encode(badClaimsJson));
    const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const dummySig = base64UrlEncode(new Uint8Array(32));

    const invalidSigToken = `${headerB64}.${badPayloadB64}.${dummySig}`;
    const result = await verifySession(invalidSigToken, [key], DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, code: 'bad_signature' });
  });
});

describe('origin and conversation matching', () => {
  it('rejects origin mismatch with origin_mismatch', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims({ org: 'https://site-a.com' }), [key]);

    const result = await verifySession(token, [key], {
      origin: 'https://site-b.com',
      conversationId: 'conv_456',
    });
    expect(result).toEqual({ ok: false, code: 'origin_mismatch' });
  });

  it('accepts exact origin match', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims({ org: 'https://site-a.com' }), [key]);

    const result = await verifySession(token, [key], {
      origin: 'https://site-a.com',
      conversationId: 'conv_456',
    });
    expect(result.ok).toBe(true);
  });

  it('returns origin_mismatch when origin is null', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims({ org: 'https://example.com' }), [key]);

    const result = await verifySession(token, [key], {
      origin: null,
      conversationId: 'conv_456',
    });
    expect(result).toEqual({ ok: false, code: 'origin_mismatch' });
  });

  it('rejects conversation ID mismatch with conversation_mismatch', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims({ cid: 'conv_123' }), [key]);

    const result = await verifySession(token, [key], {
      origin: 'https://example.com',
      conversationId: 'conv_999',
    });
    expect(result).toEqual({ ok: false, code: 'conversation_mismatch' });
  });

  it('accepts exact conversation ID match', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const token = await signSession(validClaims({ cid: 'conv_123' }), [key]);

    const result = await verifySession(token, [key], {
      origin: 'https://example.com',
      conversationId: 'conv_123',
    });
    expect(result.ok).toBe(true);
  });

  it('never returns arbitrary extra payload claims', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const claimsWithExtra = {
      ...validClaims(),
      extraClaim: 'untrusted_data',
      role: 'admin',
    };
    // @ts-expect-error extra properties tested
    const token = await signSession(claimsWithExtra, [key]);
    const result = await verifySession(token, [key], DEFAULT_OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('extraClaim' in result.claims).toBe(false);
      expect('role' in result.claims).toBe(false);
      expect((result.claims as Record<string, unknown>).extraClaim).toBeUndefined();
      expect((result.claims as Record<string, unknown>).role).toBeUndefined();
    }
  });
});

describe('key rotation', () => {
  it('verifies with the old key when it is second in the verification list', async () => {
    const oldKey = await importSessionKey(VALID_SECRET);
    const newKey = await importSessionKey(ROTATION_SECRET);

    // Old token signed with oldKey (kid is '0')
    const oldToken = await signSession(validClaims(), [oldKey]);

    // Verifier has rotated keys: [newKey, oldKey]
    // Indexed key keys[0] (newKey) fails, but keys[1] (oldKey) succeeds
    const result = await verifySession(oldToken, [newKey, oldKey], DEFAULT_OPTIONS);
    expect(result.ok).toBe(true);
  });

  it('verifies a newly signed token using keys[0] directly', async () => {
    const oldKey = await importSessionKey(VALID_SECRET);
    const newKey = await importSessionKey(ROTATION_SECRET);

    const newToken = await signSession(validClaims(), [newKey, oldKey]);
    const result = await verifySession(newToken, [newKey, oldKey], DEFAULT_OPTIONS);
    expect(result.ok).toBe(true);
  });

  it('fails with bad_signature when key is not present in keys array', async () => {
    const oldKey = await importSessionKey(VALID_SECRET);
    const unrelatedKey = await importSessionKey('another-32-byte-secret-for-chatc');

    const token = await signSession(validClaims(), [oldKey]);
    const result = await verifySession(token, [unrelatedKey], DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, code: 'bad_signature' });
  });
});

describe('malformed tokens and claims', () => {
  it('rejects non-string tokens as malformed', async () => {
    const key = await importSessionKey(VALID_SECRET);
    // @ts-expect-error testing invalid argument type
    expect(await verifySession(undefined, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
    // @ts-expect-error testing invalid argument type
    expect(await verifySession(null, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
    // @ts-expect-error testing invalid argument type
    expect(await verifySession(12345, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });

  it('rejects tokens that do not have 3 parts', async () => {
    const key = await importSessionKey(VALID_SECRET);
    expect(await verifySession('part1.part2', [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
    expect(await verifySession('p1.p2.p3.p4', [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
    expect(await verifySession('', [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
    expect(await verifySession('..', [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });

  it('rejects invalid base64url encoding as malformed', async () => {
    const key = await importSessionKey(VALID_SECRET);
    expect(await verifySession('invalid!base64.valid.sig', [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });

  it('rejects invalid JSON in header as malformed', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const badHeader = base64UrlEncode(new TextEncoder().encode('{ not valid json }'));
    const dummy = base64UrlEncode(new TextEncoder().encode('{}'));
    const dummySig = base64UrlEncode(new Uint8Array(32));
    expect(await verifySession(`${badHeader}.${dummy}.${dummySig}`, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });

    const arrayHeader = base64UrlEncode(new TextEncoder().encode('[1, 2, 3]'));
    expect(await verifySession(`${arrayHeader}.${dummy}.${dummySig}`, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });

  it('rejects invalid base64url or invalid JSON in payload as malformed', async () => {
    const key = await importSessionKey(VALID_SECRET);
    const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const dummySig = base64UrlEncode(new Uint8Array(32));
    // Invalid base64url in payload
    expect(await verifySession(`${headerB64}.not!b64.${dummySig}`, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });

    // Valid signature over non-JSON payload
    const nonJsonPayloadB64 = base64UrlEncode(new TextEncoder().encode('not json'));
    const signingInput = `${headerB64}.${nonJsonPayloadB64}`;
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
    const sigB64 = base64UrlEncode(new Uint8Array(sigBuf));
    expect(await verifySession(`${headerB64}.${nonJsonPayloadB64}.${sigB64}`, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });

    // Valid signature over array payload
    const arrayPayloadB64 = base64UrlEncode(new TextEncoder().encode('[1, 2, 3]'));
    const arrayInput = `${headerB64}.${arrayPayloadB64}`;
    const arraySigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(arrayInput));
    const arraySigB64 = base64UrlEncode(new Uint8Array(arraySigBuf));
    expect(await verifySession(`${headerB64}.${arrayPayloadB64}.${arraySigB64}`, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });

  it('rejects claims with invalid v', async () => {
    const key = await importSessionKey(VALID_SECRET);
    // @ts-expect-error testing invalid claim
    const token = await signSession({ ...validClaims(), v: 2 }, [key]);
    expect(await verifySession(token, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });

  it('rejects claims with missing or non-string sid, cid, org', async () => {
    const key = await importSessionKey(VALID_SECRET);
    for (const field of ['sid', 'cid', 'org'] as const) {
      // @ts-expect-error testing invalid claim
      const token = await signSession({ ...validClaims(), [field]: 12345 }, [key]);
      expect(await verifySession(token, [key], DEFAULT_OPTIONS)).toEqual({
        ok: false,
        code: 'malformed',
      });
    }
  });

  it('rejects non-string uid or tier when present', async () => {
    const key = await importSessionKey(VALID_SECRET);
    // @ts-expect-error testing invalid claim
    const token1 = await signSession({ ...validClaims(), uid: 123 }, [key]);
    expect(await verifySession(token1, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });

    // @ts-expect-error testing invalid claim
    const token2 = await signSession({ ...validClaims(), tier: true }, [key]);
    expect(await verifySession(token2, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });

  it('rejects non-numeric or non-finite iat or exp', async () => {
    const key = await importSessionKey(VALID_SECRET);
    // @ts-expect-error testing invalid claim
    const token1 = await signSession({ ...validClaims(), iat: 'not a number' }, [key]);
    expect(await verifySession(token1, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });

    // @ts-expect-error testing invalid claim
    const token2 = await signSession({ ...validClaims(), exp: Number.POSITIVE_INFINITY }, [key]);
    expect(await verifySession(token2, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });

    // @ts-expect-error testing invalid claim
    const token3 = await signSession({ ...validClaims(), exp: Number.NaN }, [key]);
    expect(await verifySession(token3, [key], DEFAULT_OPTIONS)).toEqual({
      ok: false,
      code: 'malformed',
    });
  });
});

describe('RFC 7515 Appendix A.1 test vector', () => {
  // Published RFC 7515 Appendix A.1 values
  const RFC_KEY_B64 = 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow';
  const RFC_TOKEN =
    'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

  it('verifies the exact published RFC 7515 A.1 signature using the exact published token and key', async () => {
    const keyBytes = base64UrlDecode(RFC_KEY_B64);
    expect(keyBytes.byteLength).toBe(64); // 512-bit key

    const key = await importSessionKey(keyBytes);
    expect(key).toBeDefined();

    // Verify signature independently with verifySessionSignature
    const valid = await verifySessionSignature(RFC_TOKEN, [key]);
    expect(valid).toBe(true);

    // Verify signature independently with crypto.subtle.verify
    const [header, payload, signature] = RFC_TOKEN.split('.');
    const signingInputBytes = new TextEncoder().encode(`${header}.${payload}`);
    const sigBytes = base64UrlDecode(signature);
    const subtleValid = await crypto.subtle.verify('HMAC', key, sigBytes, signingInputBytes);
    expect(subtleValid).toBe(true);
  });

  it('rejects RFC 7515 token in verifySession as malformed claims without weakening claim validation', async () => {
    const keyBytes = base64UrlDecode(RFC_KEY_B64);
    const key = await importSessionKey(keyBytes);

    // Calling verifySession validates signature successfully, but then strictly rejects non-session claims as malformed
    const result = await verifySession(RFC_TOKEN, [key], DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, code: 'malformed' });
  });

  it('rejects tampered signature on RFC 7515 token', async () => {
    const keyBytes = base64UrlDecode(RFC_KEY_B64);
    const key = await importSessionKey(keyBytes);

    const [header, payload, signature] = RFC_TOKEN.split('.');
    const tamperedSig = `e${signature.slice(1)}`;
    const tamperedToken = `${header}.${payload}.${tamperedSig}`;

    const valid = await verifySessionSignature(tamperedToken, [key]);
    expect(valid).toBe(false);

    const result = await verifySession(tamperedToken, [key], DEFAULT_OPTIONS);
    expect(result).toEqual({ ok: false, code: 'bad_signature' });
  });

  it('verifySessionSignature handles invalid token formats and empty keys', async () => {
    const key = await importSessionKey(VALID_SECRET);
    // @ts-expect-error invalid token type
    expect(await verifySessionSignature(12345, [key])).toBe(false);
    expect(await verifySessionSignature('part1.part2', [key])).toBe(false);
    expect(await verifySessionSignature('..', [key])).toBe(false);
    expect(await verifySessionSignature('invalid!b64.part.part', [key])).toBe(false);
    expect(await verifySessionSignature('part.part.invalid!b64', [key])).toBe(false);

    const badHeader = base64UrlEncode(new TextEncoder().encode('{ bad json }'));
    const dummy = base64UrlEncode(new TextEncoder().encode('{}'));
    const dummySig = base64UrlEncode(new Uint8Array(32));
    expect(await verifySessionSignature(`${badHeader}.${dummy}.${dummySig}`, [key])).toBe(false);

    const badAlgHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'none' })));
    expect(await verifySessionSignature(`${badAlgHeader}.${dummy}.${dummySig}`, [key])).toBe(false);

    const validToken = await signSession(validClaims(), [key]);
    expect(await verifySessionSignature(validToken, [])).toBe(false);
  });
});
