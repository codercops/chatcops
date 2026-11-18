import { consoleLogger, type Logger } from '@chatcops/core';
import { errorBody, type WireErrorBody, type WireErrorCode } from '@chatcops/core';
import { base64UrlDecode, importSessionKey, signSession, verifySession, verifySessionSignature, type SessionClaims } from './session-token.js';
import { verifyTurnstile, type TurnstileConfig } from './turnstile.js';

/**
 * Session tokens for the chat endpoint. `POST /session` gives the widget a
 * short-lived token bound to its origin and one conversation id, and chat
 * requests send it as `Authorization: Bearer <token>`. A visitor who guesses
 * another conversation's id can't get a token for it, so the id alone no
 * longer reads or writes someone else's conversation.
 */

export const DEFAULT_SESSION_TTL_SEC = 900;
/** An expired token still resumes its conversation for this long after it expires. */
export const SESSION_RESUME_GRACE_SEC = 30 * 24 * 60 * 60;
const MIN_SECRET_BYTES = 32;
const MAX_ID_LENGTH = 128;

export interface SessionConfig {
  logger?: Logger;
  sessionSecrets?: string[];
  sessionTtlSec?: number;
  allowAnonymous?: boolean;
  turnstile?: TurnstileConfig;
  identity?: { secret: string };
}

/** What `/session` needs to know about a conversation id. */
export interface ConversationInfo {
  /** Nothing is stored under it yet. */
  unused: boolean;
  /** The signed-in user it belongs to, from a `userToken`. */
  uid?: string;
}

export type SessionCheck =
  | { ok: true; claims?: SessionClaims }
  | { ok: false; code: WireErrorCode; message: string };

export interface SessionReply {
  status: number;
  body: { token: string; expiresAt: number; conversationId: string } | WireErrorBody;
}

export interface Sessions {
  /** Whether chat requests without a token are refused. */
  required: boolean;
  /** Answers `POST /session`. */
  mint(body: unknown, origin: string | null, clientIp?: string): Promise<SessionReply>;
  /** Checks the `Authorization` header of a chat request for this conversation. */
  check(authorization: string | null | undefined, origin: string | null, conversationId: string): Promise<SessionCheck>;
}

/**
 * `undefined` when `sessionSecrets` isn't set. Throws at startup on a bad
 * config. `lookup` says what's stored under a conversation id.
 */
export function createSessions(
  config: SessionConfig,
  lookup: (conversationId: string) => Promise<ConversationInfo> = async () => ({ unused: false }),
  now: () => number = Date.now
): Sessions | undefined {
  const secrets = config.sessionSecrets;
  if (secrets === undefined) {
    if (!config.allowAnonymous) {
      throw new Error(
        'Chat requests need a session token unless `allowAnonymous: true` is set. Set `sessionSecrets` (generate one with `openssl rand -base64 32`, and keep it on the server); the widget fetches tokens by itself. Or set `allowAnonymous: true` to accept chat without them. See https://chat.codercops.com/server/setup/#session-tokens'
      );
    }
    if (config.turnstile) throw new Error('`turnstile` is checked when a session token is issued, so it needs `sessionSecrets`.');
    if (config.identity) throw new Error('`identity` goes into session tokens, so it needs `sessionSecrets`.');
    return undefined;
  }
  const identitySecret = config.identity?.secret;
  if (config.identity && (typeof identitySecret !== 'string' || new TextEncoder().encode(identitySecret).byteLength < MIN_SECRET_BYTES)) {
    throw new Error(`\`identity.secret\` needs at least ${MIN_SECRET_BYTES} bytes, like \`sessionSecrets\`.`);
  }
  const turnstile = config.turnstile;
  if (turnstile && !turnstile.secretKey) throw new Error('`turnstile` needs its `secretKey`.');
  if (!Array.isArray(secrets) || secrets.length === 0) throw new Error('`sessionSecrets` needs at least one secret.');
  secrets.forEach((secret, i) => {
    const bytes = typeof secret === 'string' ? new TextEncoder().encode(secret).byteLength : 0;
    if (bytes < MIN_SECRET_BYTES) {
      throw new Error(`sessionSecrets[${i}] is ${bytes} bytes; it needs at least ${MIN_SECRET_BYTES}. Generate one with \`openssl rand -base64 32\`.`);
    }
  });
  const ttlSec = config.sessionTtlSec ?? DEFAULT_SESSION_TTL_SEC;
  if (!(Number.isInteger(ttlSec) && ttlSec > 0)) throw new Error('`sessionTtlSec` must be a whole number of seconds above 0.');

  // Imported on first use: Workers don't allow crypto.subtle at global scope.
  let keys: Promise<CryptoKey[]> | undefined;
  const getKeys = () => (keys ??= Promise.all(secrets.map((secret) => importSessionKey(secret))));
  let identityKey: Promise<CryptoKey> | undefined;
  const getIdentityKey = () => (identityKey ??= importSessionKey(identitySecret as string));
  const nowSec = () => Math.floor(now() / 1000);
  const required = !config.allowAnonymous;

  return {
    required,

    async mint(body, origin, clientIp) {
      const request = readMintRequest(body);
      if (!request) return { status: 400, body: errorBody('invalid_request', { message: 'Invalid session request' }) };
      const org = origin ?? '';
      const time = nowSec();

      // Resuming a conversation needs a token that was issued for it, from
      // this origin. Expired is fine within the grace window. An id with
      // nothing stored yet (the widget makes its own) is given out as is,
      // since there's nothing in it to read, and so is a signed-in user's own
      // conversation (with a \`userToken\` for them). Anything else gets a new
      // conversation, so a guessed or leaked id is useless.
      let resumed: SessionClaims | undefined;
      let cid: string | undefined;
      if (request.conversationId && request.previousToken) {
        const result = await verifySession(request.previousToken, await getKeys(), {
          origin: org,
          conversationId: request.conversationId,
          now: time,
          clockSkewSec: SESSION_RESUME_GRACE_SEC,
        });
        if (result.ok) resumed = result.claims;
      }
      // A visitor the host site signed in. A token that doesn't verify is an
      // error, not an anonymous session, so a bug on the host site shows.
      let user: UserClaims | undefined;
      if (request.userToken !== undefined) {
        if (!identitySecret) return { status: 400, body: errorBody('invalid_request', { message: '`userToken` needs `identity` on the server.' }) };
        user = await verifyUserToken(request.userToken, await getIdentityKey(), time);
        if (!user) return { status: 401, body: errorBody('session_required', { message: 'The userToken is invalid or has expired.' }) };
      }
      // A token for another user doesn't carry over.
      if (resumed?.uid && resumed.uid !== user?.sub) resumed = undefined;

      // A refresh was checked when its first token was issued; a new session
      // has to pass Turnstile first.
      if (turnstile && !resumed) {
        const result = await verifyTurnstile(request.turnstileToken, turnstile, {
          remoteIp: clientIp,
          idempotencyKey: request.idempotencyKey,
        });
        if (!result.ok) {
          if (result.code === 'unavailable') {
            (config.logger ?? consoleLogger()).warn('turnstile_unavailable', 'Turnstile could not be reached, so no session token was issued.');
            return { status: 503, body: errorBody('turnstile_failed', { message: 'Turnstile could not be reached. Try again.' }) };
          }
          return { status: 401, body: errorBody('turnstile_failed', { message: 'The Turnstile check failed.' }) };
        }
      }

      if (resumed) cid = resumed.cid;
      else if (request.conversationId) {
        const info = await lookup(request.conversationId);
        // Nothing stored yet, or this signed-in user's own conversation.
        if (info.unused || (user && info.uid === user.sub)) cid = request.conversationId;
      }

      const claims: SessionClaims = {
        v: 1,
        sid: resumed?.sid ?? crypto.randomUUID(),
        cid: cid ?? crypto.randomUUID(),
        org,
        iat: time,
        exp: time + ttlSec,
        ...(user ? { uid: user.sub, ...(user.tier ? { tier: user.tier } : {}) } : {}),
      };
      const token = await signSession(claims, await getKeys());
      return { status: 200, body: { token, expiresAt: claims.exp * 1000, conversationId: claims.cid } };
    },

    async check(authorization, origin, conversationId): Promise<SessionCheck> {
      const token = bearer(authorization);
      if (!token) {
        return required
          ? { ok: false, code: 'session_required', message: 'This chat needs a session token. Get one from POST /session.' }
          : { ok: true };
      }
      const result = await verifySession(token, await getKeys(), { origin: origin ?? '', conversationId, now: nowSec() });
      if (result.ok) return { ok: true, claims: result.claims };
      switch (result.code) {
        case 'expired':
          return { ok: false, code: 'token_expired', message: 'The session token has expired. Get a new one from POST /session.' };
        case 'conversation_mismatch':
          return { ok: false, code: 'conversation_mismatch', message: 'The session token is for a different conversation.' };
        default:
          return { ok: false, code: 'session_required', message: 'The session token is invalid. Get a new one from POST /session.' };
      }
    },
  };
}

function bearer(header: string | null | undefined): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1];
}

interface MintRequest {
  conversationId?: string;
  previousToken?: string;
  /** Signed by the host site with `identity.secret`: `{ sub, exp, tier? }`. */
  userToken?: string;
  turnstileToken?: string;
  /** Sent again with a retried request, so Cloudflare accepts the same Turnstile token twice. */
  idempotencyKey?: string;
}

function readMintRequest(body: unknown): MintRequest | undefined {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) return undefined;
  const { conversationId, previousToken, turnstileToken, idempotencyKey, userToken } = body as Record<string, unknown>;
  const request: MintRequest = {};
  if (userToken !== undefined) {
    if (typeof userToken !== 'string' || userToken.length > 4096) return undefined;
    request.userToken = userToken;
  }
  if (turnstileToken !== undefined) {
    if (typeof turnstileToken !== 'string' || turnstileToken.length > 4096) return undefined;
    request.turnstileToken = turnstileToken;
  }
  if (idempotencyKey !== undefined) {
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length > 128) return undefined;
    request.idempotencyKey = idempotencyKey;
  }
  if (conversationId !== undefined) {
    if (typeof conversationId !== 'string' || conversationId.length === 0 || conversationId.length > MAX_ID_LENGTH) return undefined;
    request.conversationId = conversationId;
  }
  if (previousToken !== undefined) {
    if (typeof previousToken !== 'string' || previousToken.length > 4096) return undefined;
    request.previousToken = previousToken;
  }
  return request;
}

interface UserClaims {
  sub: string;
  tier?: string;
}

/**
 * A host site's `userToken`: an HS256 JWT signed with `identity.secret`, with
 * `sub` (the user id, up to 128 characters), `exp` in seconds and an optional
 * `tier`. `undefined` when it doesn't verify or has expired.
 */
export async function verifyUserToken(token: string, key: CryptoKey, nowSec: number): Promise<UserClaims | undefined> {
  if (!(await verifySessionSignature(token, [key]))) return undefined;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(token.split('.')[1] ?? '')));
  } catch {
    return undefined;
  }
  const { sub, exp, tier } = payload ?? {};
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 128) return undefined;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp + 60 < nowSec) return undefined;
  if (tier !== undefined && (typeof tier !== 'string' || tier.length > 64)) return undefined;
  return { sub, ...(typeof tier === 'string' ? { tier } : {}) };
}
