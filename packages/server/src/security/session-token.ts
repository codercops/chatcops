/**
 * Session token signing and verification using compact JWS with HS256 and Web Crypto (crypto.subtle).
 */

export interface SessionClaims {
  v: 1;
  sid: string;
  cid: string;
  org: string;
  iat: number;
  exp: number;
  uid?: string;
  tier?: string;
}

export type VerifySessionResult =
  | { ok: true; claims: SessionClaims }
  | {
      ok: false;
      code:
        | 'malformed'
        | 'bad_signature'
        | 'expired'
        | 'origin_mismatch'
        | 'conversation_mismatch';
    };

export interface VerifySessionOptions {
  origin: string | null;
  conversationId: string;
  now?: number;
  clockSkewSec?: number;
}

const B64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const B64URL_LOOKUP = new Int8Array(256).fill(-1);
for (let i = 0; i < B64URL_CHARS.length; i++) {
  B64URL_LOOKUP[B64URL_CHARS.charCodeAt(i)] = i;
}

/**
 * Strict, unpadded base64url encoding.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  let i = 0;

  for (; i + 2 < len; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    result +=
      B64URL_CHARS[b0 >> 2] +
      B64URL_CHARS[((b0 & 3) << 4) | (b1 >> 4)] +
      B64URL_CHARS[((b1 & 15) << 2) | (b2 >> 6)] +
      B64URL_CHARS[b2 & 63];
  }

  if (i < len) {
    const b0 = bytes[i];
    if (i + 1 < len) {
      const b1 = bytes[i + 1];
      result +=
        B64URL_CHARS[b0 >> 2] +
        B64URL_CHARS[((b0 & 3) << 4) | (b1 >> 4)] +
        B64URL_CHARS[(b1 & 15) << 2];
    } else {
      result +=
        B64URL_CHARS[b0 >> 2] +
        B64URL_CHARS[(b0 & 3) << 4];
    }
  }

  return result;
}

/**
 * Strict, unpadded base64url decoding. Rejects padding ('='), non-base64url characters,
 * invalid lengths (len % 4 === 1), and non-canonical trailing bits.
 */
export function base64UrlDecode(str: string): Uint8Array {
  if (typeof str !== 'string' || str.length === 0) {
    throw new Error('Invalid base64url string: empty');
  }
  const len = str.length;
  const rem = len % 4;
  if (rem === 1) {
    throw new Error('Invalid base64url string: length % 4 cannot be 1');
  }

  const byteLen = Math.floor(len / 4) * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(byteLen);

  let inIdx = 0;
  let outIdx = 0;
  const fullChunks = Math.floor(len / 4);

  for (let i = 0; i < fullChunks; i++) {
    const code0 = str.charCodeAt(inIdx++);
    const code1 = str.charCodeAt(inIdx++);
    const code2 = str.charCodeAt(inIdx++);
    const code3 = str.charCodeAt(inIdx++);

    if (code0 >= 256 || code1 >= 256 || code2 >= 256 || code3 >= 256) {
      throw new Error('Invalid base64url character');
    }

    const c0 = B64URL_LOOKUP[code0];
    const c1 = B64URL_LOOKUP[code1];
    const c2 = B64URL_LOOKUP[code2];
    const c3 = B64URL_LOOKUP[code3];

    if (c0 === -1 || c1 === -1 || c2 === -1 || c3 === -1) {
      throw new Error('Invalid base64url character');
    }

    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
    out[outIdx++] = ((c2 & 3) << 6) | c3;
  }

  if (rem === 2) {
    const code0 = str.charCodeAt(inIdx++);
    const code1 = str.charCodeAt(inIdx++);
    if (code0 >= 256 || code1 >= 256) {
      throw new Error('Invalid base64url character');
    }
    const c0 = B64URL_LOOKUP[code0];
    const c1 = B64URL_LOOKUP[code1];
    if (c0 === -1 || c1 === -1 || (c1 & 15) !== 0) {
      throw new Error('Invalid base64url character or non-canonical trailing bits');
    }
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
  } else if (rem === 3) {
    const code0 = str.charCodeAt(inIdx++);
    const code1 = str.charCodeAt(inIdx++);
    const code2 = str.charCodeAt(inIdx++);
    if (code0 >= 256 || code1 >= 256 || code2 >= 256) {
      throw new Error('Invalid base64url character');
    }
    const c0 = B64URL_LOOKUP[code0];
    const c1 = B64URL_LOOKUP[code1];
    const c2 = B64URL_LOOKUP[code2];
    if (c0 === -1 || c1 === -1 || c2 === -1 || (c2 & 3) !== 0) {
      throw new Error('Invalid base64url character or non-canonical trailing bits');
    }
    out[outIdx++] = (c0 << 2) | (c1 >> 4);
    out[outIdx++] = ((c1 & 15) << 4) | (c2 >> 2);
  }

  return out;
}

/**
 * Imports an HMAC-SHA256 key for signing and verifying session tokens.
 * Rejects secrets shorter than 32 UTF-8 bytes with a clear error.
 * Does not access crypto.subtle at module load time.
 */
export async function importSessionKey(secret: string | Uint8Array): Promise<CryptoKey> {
  const bytes = typeof secret === 'string' ? new TextEncoder().encode(secret) : new Uint8Array(secret);
  if (bytes.byteLength < 32) {
    throw new Error(`Session secret must be at least 32 bytes (got ${bytes.byteLength})`);
  }
  return await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

/**
 * Signs session claims using the first key in keys and sets kid to '0'.
 */
export async function signSession(
  claims: SessionClaims | (Omit<SessionClaims, 'v'> & { v?: 1 }),
  keys: CryptoKey[]
): Promise<string> {
  if (keys.length === 0) {
    throw new Error('At least one key is required to sign');
  }

  const signingKey = keys[0];
  const fullClaims = {
    ...(claims as unknown as Record<string, unknown>),
    v: ((claims as Record<string, unknown>).v ?? 1) as 1,
  };

  const header = {
    alg: 'HS256',
    typ: 'JWT',
    kid: '0',
  };

  const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(fullClaims)));

  const signingInput = `${headerB64}.${payloadB64}`;
  const signingInputBytes = new TextEncoder().encode(signingInput);

  const signatureBuffer = await crypto.subtle.sign('HMAC', signingKey, signingInputBytes);
  const signatureB64 = base64UrlEncode(new Uint8Array(signatureBuffer));

  return `${signingInput}.${signatureB64}`;
}

/**
 * Verifies a compact JWS signature over `header.payload` using HS256 and the provided key(s).
 * Does not validate SessionClaims.
 */
export async function verifySessionSignature(
  token: string,
  keys: CryptoKey[]
): Promise<boolean> {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return false;

  let headerBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    headerBytes = base64UrlDecode(headerPart);
    signatureBytes = base64UrlDecode(signaturePart);
  } catch {
    return false;
  }

  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return false;
  }
  if (typeof header !== 'object' || header === null || Array.isArray(header)) return false;
  const headerObj = header as Record<string, unknown>;
  if (headerObj.alg !== 'HS256') return false;

  if (keys.length === 0) return false;

  const signingInputBytes = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const kidRaw = headerObj.kid;
  const indexedIdx =
    typeof kidRaw === 'number'
      ? kidRaw
      : typeof kidRaw === 'string' && /^\d+$/.test(kidRaw)
        ? parseInt(kidRaw, 10)
        : undefined;

  if (indexedIdx !== undefined && indexedIdx >= 0 && indexedIdx < keys.length) {
    try {
      if (await crypto.subtle.verify('HMAC', keys[indexedIdx], signatureBytes as BufferSource, signingInputBytes)) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  for (let i = 0; i < keys.length; i++) {
    if (i === indexedIdx) continue;
    try {
      if (await crypto.subtle.verify('HMAC', keys[i], signatureBytes as BufferSource, signingInputBytes)) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

/**
 * Verifies a session token.
 * 1. Checks compact JWS format (header.payload.signature) and base64url decoding.
 * 2. Verifies header alg is HS256 (rejects none and any other algorithm).
 * 3. Verifies signature over the exact original header.payload bytes via verifySessionSignature.
 * 4. Only after signature verification succeeds, validates session claims:
 *    v must be 1; sid, cid, org must be strings; uid and tier (if present) must be strings;
 *    iat and exp must be valid numeric seconds.
 * 5. Constructs returned claims exclusively from validated fields (never spreads untrusted payload).
 * 6. Enforces expiration with clock skew (default 60s), exact origin matching, and exact conversation ID matching.
 */
export async function verifySession(
  token: string,
  keys: CryptoKey[],
  options: VerifySessionOptions
): Promise<VerifySessionResult> {
  if (typeof token !== 'string') {
    return { ok: false, code: 'malformed' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return { ok: false, code: 'malformed' };
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart) {
    return { ok: false, code: 'malformed' };
  }

  let headerBytes: Uint8Array;
  try {
    headerBytes = base64UrlDecode(headerPart);
  } catch {
    return { ok: false, code: 'malformed' };
  }

  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch {
    return { ok: false, code: 'malformed' };
  }

  if (typeof header !== 'object' || header === null || Array.isArray(header)) {
    return { ok: false, code: 'malformed' };
  }

  const headerObj = header as Record<string, unknown>;

  // Reject algorithms other than HS256, including 'none'
  if (headerObj.alg !== 'HS256') {
    return { ok: false, code: 'bad_signature' };
  }

  if (!signaturePart) {
    return { ok: false, code: 'bad_signature' };
  }

  let payloadBytes: Uint8Array;
  try {
    payloadBytes = base64UrlDecode(payloadPart);
    base64UrlDecode(signaturePart);
  } catch {
    return { ok: false, code: 'malformed' };
  }

  const verified = await verifySessionSignature(token, keys);
  if (!verified) {
    return { ok: false, code: 'bad_signature' };
  }

  // Validate all claims only after signature verification
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, code: 'malformed' };
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, code: 'malformed' };
  }

  const p = payload as Record<string, unknown>;

  if (p.v !== 1) {
    return { ok: false, code: 'malformed' };
  }
  if (typeof p.sid !== 'string') {
    return { ok: false, code: 'malformed' };
  }
  if (typeof p.cid !== 'string') {
    return { ok: false, code: 'malformed' };
  }
  if (typeof p.org !== 'string') {
    return { ok: false, code: 'malformed' };
  }
  if (p.uid !== undefined && typeof p.uid !== 'string') {
    return { ok: false, code: 'malformed' };
  }
  if (p.tier !== undefined && typeof p.tier !== 'string') {
    return { ok: false, code: 'malformed' };
  }
  if (typeof p.iat !== 'number' || !Number.isFinite(p.iat)) {
    return { ok: false, code: 'malformed' };
  }
  if (typeof p.exp !== 'number' || !Number.isFinite(p.exp)) {
    return { ok: false, code: 'malformed' };
  }

  // Construct returned claims exclusively from validated fields
  const claims: SessionClaims = {
    v: 1,
    sid: p.sid,
    cid: p.cid,
    org: p.org,
    iat: p.iat,
    exp: p.exp,
    ...(typeof p.uid === 'string' ? { uid: p.uid } : {}),
    ...(typeof p.tier === 'string' ? { tier: p.tier } : {}),
  };

  // Expiration check with clock skew (default 60 seconds), strictly in seconds
  const clockSkewSec = options.clockSkewSec ?? 60;
  const nowSec = options.now ?? Math.floor(Date.now() / 1000);

  if (nowSec - clockSkewSec > claims.exp) {
    return { ok: false, code: 'expired' };
  }

  // Exact origin matching (origin: null directly compares claims.org !== null)
  if (claims.org !== options.origin) {
    return { ok: false, code: 'origin_mismatch' };
  }

  // Exact conversation ID matching
  if (claims.cid !== options.conversationId) {
    return { ok: false, code: 'conversation_mismatch' };
  }

  return { ok: true, claims };
}
