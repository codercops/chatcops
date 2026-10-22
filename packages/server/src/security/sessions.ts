import { errorBody, type WireErrorBody, type WireErrorCode } from '@chatcops/core';
import { importSessionKey, signSession, verifySession, type SessionClaims } from './session-token.js';

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
  sessionSecrets?: string[];
  sessionTtlSec?: number;
  requireSession?: boolean;
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
  mint(body: unknown, origin: string | null): Promise<SessionReply>;
  /** Checks the `Authorization` header of a chat request for this conversation. */
  check(authorization: string | null | undefined, origin: string | null, conversationId: string): Promise<SessionCheck>;
}

/** `undefined` when `sessionSecrets` isn't set. Throws at startup on a bad config. */
export function createSessions(config: SessionConfig, now: () => number = Date.now): Sessions | undefined {
  const secrets = config.sessionSecrets;
  if (secrets === undefined) {
    if (config.requireSession) throw new Error('`requireSession` needs `sessionSecrets` to sign tokens with.');
    return undefined;
  }
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
  const nowSec = () => Math.floor(now() / 1000);
  const required = config.requireSession ?? true;

  return {
    required,

    async mint(body, origin) {
      const request = readMintRequest(body);
      if (!request) return { status: 400, body: errorBody('invalid_request', { message: 'Invalid session request' }) };
      const org = origin ?? '';
      const time = nowSec();

      // Resuming a conversation needs a token that was issued for it, from
      // this origin. Expired is fine within the grace window. Anything else
      // gets a new conversation, so a guessed id is useless.
      let resumed: SessionClaims | undefined;
      if (request.conversationId && request.previousToken) {
        const result = await verifySession(request.previousToken, await getKeys(), {
          origin: org,
          conversationId: request.conversationId,
          now: time,
          clockSkewSec: SESSION_RESUME_GRACE_SEC,
        });
        if (result.ok) resumed = result.claims;
      }

      const claims: SessionClaims = {
        v: 1,
        sid: resumed?.sid ?? crypto.randomUUID(),
        cid: resumed?.cid ?? crypto.randomUUID(),
        org,
        iat: time,
        exp: time + ttlSec,
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

function readMintRequest(body: unknown): { conversationId?: string; previousToken?: string } | undefined {
  if (body === undefined || body === null) return {};
  if (typeof body !== 'object' || Array.isArray(body)) return undefined;
  const { conversationId, previousToken } = body as Record<string, unknown>;
  const request: { conversationId?: string; previousToken?: string } = {};
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
