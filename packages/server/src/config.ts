import { z } from 'zod';
import type { ClientIpResolver } from './client-ip.js';
import type { TurnstileConfig } from './security/turnstile.js';
import type {
  AIProvider,
  Budgets,
  ChatCopsStorage,
  ChatTool,
  KnowledgeSource,
  Logger,
  ProviderConfig,
  WebhookConfig,
} from '@chatcops/core';

export interface ChatCopsServerConfig {
  /**
   * Which model to use: a config like `{ type: 'claude', apiKey }`, or a
   * provider object you built yourself (anything with `step()` or `chat()`).
   */
  provider: ProviderConfig | AIProvider;
  systemPrompt: string;
  /**
   * Where the server writes startup notes, refused requests and every error
   * it handles instead of throwing, each with a stable `event` name. Default
   * `consoleLogger()`; `jsonLogger()` writes one JSON object per line.
   */
  logger?: Logger;
  tools?: ChatTool[];
  toolTimeoutMs?: number;
  /** Most tokens in one reply. Defaults to 4096 (`DEFAULT_MAX_TOKENS` in @chatcops/core). */
  maxTokens?: number;
  /** Sampling temperature. Defaults to the provider's own; the allowed range depends on the provider. */
  temperature?: number;
  knowledge?: KnowledgeSource[];
  rateLimit?: { maxRequests: number; windowMs: number };
  /**
   * Token, reply and dollar limits per conversation, per IP per day and
   * overall per day, counted in `storage` so they hold across instances. A
   * reply that would go over ends with an error instead of calling the model.
   * On by default (`DEFAULT_BUDGETS`: 200 replies per conversation, 2M tokens
   * per IP per day). A scope you set replaces its default, `false` turns a
   * scope off, and `budgets: false` turns them all off.
   */
  budgets?: Budgets | false;
  /**
   * The pre-chat form fields to keep (the `name`s in the widget's
   * `preChatForm.fields`). Other fields a request sends are dropped. Unset
   * keeps every field. Answers are stored with the conversation from its
   * first message and can't change after that.
   */
  preChatFields?: string[];
  webhooks?: WebhookConfig[];
  analytics?: boolean;
  /** Bearer token required to read the analytics endpoint. When unset, the endpoint is public. */
  analyticsToken?: string;
  /**
   * Where conversations (and, with stores that have them, counters, turn
   * locks and events) live: `postgresStorage(...)`, `redisStorage(...)` and
   * so on. Defaults to memory, which doesn't survive a restart and isn't
   * shared between serverless instances.
   */
  storage?: ChatCopsStorage;
  /**
   * How long to keep conversations. `purge()` on the handler deletes older
   * ones; call it on a schedule (a cron job, a Workers cron trigger).
   */
  retention?: { conversationsDays?: number };
  /**
   * The sites that can use the chat: exact origins (`'https://acme.com'`) or
   * subdomain wildcards (`'https://*.acme.com'`). A browser request from any
   * other page gets 403 `origin_not_allowed` before the model is called.
   * Requests without an `Origin` header (curl, your own server) pass: this
   * stops other sites embedding your bot, not scripts. Defaults to `['*']`.
   */
  allowedOrigins?: string[];
  /**
   * Reads the visitor's IP for per-IP rate limits and budgets, in the fetch
   * handlers (`chatcopsVercelHandler`, `chatcopsCloudflareHandler`). Needed
   * where the handler can't tell on its own: any host other than Vercel or
   * Cloudflare. Read only a header your platform or proxy sets, never one a
   * visitor can send. Return `undefined` to skip per-IP limits for a request.
   * Express uses `req.ip`, which follows its `trust proxy` setting.
   */
  clientIp?: ClientIpResolver;
  /**
   * Turns on session tokens. `POST <chat url>/session` gives the widget a
   * token bound to its origin and one conversation, and chat requests send
   * it as `Authorization: Bearer <token>`, so a guessed conversation id is
   * useless. Sign with the first secret and verify with all of them, so a
   * new secret goes first and the old one stays until its tokens expire.
   * Each needs at least 32 bytes (`openssl rand -base64 32`). Keep them
   * server side, never in a client bundle.
   */
  sessionSecrets?: string[];
  /** How long a session token lasts, in seconds. Defaults to 900. */
  sessionTtlSec?: number;
  /**
   * Accept chat requests without a session token. Off by default: the
   * server needs `sessionSecrets`, and each chat request needs a token from
   * `<chat url>/session`, which the widget gets by itself. Set true for a
   * server without `sessionSecrets`, or, with them, while widgets older than
   * 0.6 (which don't send tokens) are still out there.
   */
  allowAnonymous?: boolean;
  /**
   * Cloudflare Turnstile when a session token is issued: `/session` needs a
   * Turnstile token and checks it with Cloudflare before signing. Refreshing
   * a session with its previous token skips it. Needs `sessionSecrets`, and
   * the widget's `turnstileSiteKey`.
   */
  turnstile?: TurnstileConfig;
  /**
   * Signed-in visitors. Your site signs a \`userToken\` (an HS256 JWT with
   * \`sub\`, \`exp\` and an optional \`tier\`) with \`secret\`, and the widget
   * sends it with \`/session\`. The user id is stored on the conversation, so
   * the same user can resume it with a fresh token, and \`tiers\` gives a
   * tier its own budgets (merged over \`budgets\`). Needs \`sessionSecrets\`.
   */
  identity?: { secret: string; tiers?: Record<string, Budgets> };
  /**
   * Adds the reply's token usage to the `finish` part of protocol v1
   * streams. Off by default, since visitors can read the stream.
   */
  exposeUsage?: boolean;
}

// Everything in a request can end up in the system prompt, so every field has a ceiling.
export const MAX_USER_DATA_FIELDS = 50;
/** `pageContext.data`, what a site adds with the widget's setContext(). */
export const MAX_PAGE_DATA_FIELDS = 20;
export const MAX_PAGE_DATA_KEY_LENGTH = 40;
export const MAX_PAGE_DATA_VALUE_LENGTH = 500;
export const MAX_USER_DATA_KEY_LENGTH = 100;
/** Longer page URLs are still accepted, but only this much reaches the prompt. */
export const MAX_PAGE_URL_LENGTH = 2000;

export const chatRequestSchema = z.object({
  conversationId: z.string().min(1).max(128),
  message: z.string().min(1).max(10000),
  messageId: z.string().min(1).max(128).optional(),
  /**
   * `{ assistantMessageId }` replaces that reply. `true` (the 0.5 form)
   * replaces the reply to `messageId`, or the latest one.
   */
  regenerate: z.union([z.boolean(), z.object({ assistantMessageId: z.string().min(1).max(128) })]).optional(),
  pageContext: z.object({
    url: z.string().url(),
    title: z.string().max(500),
    description: z.string().max(1000).optional(),
    contentSnippet: z.string().max(2000).optional(),
    data: z
      .record(z.string().max(MAX_PAGE_DATA_KEY_LENGTH), z.string().max(MAX_PAGE_DATA_VALUE_LENGTH))
      .refine((data) => Object.keys(data).length <= MAX_PAGE_DATA_FIELDS, {
        message: `pageContext.data can have at most ${MAX_PAGE_DATA_FIELDS} fields`,
      })
      .optional(),
  }).optional(),
  locale: z.string().max(10).optional(),
  userData: z
    .record(z.string().max(MAX_USER_DATA_KEY_LENGTH), z.string().max(500))
    .refine((data) => Object.keys(data).length <= MAX_USER_DATA_FIELDS, {
      message: `userData can have at most ${MAX_USER_DATA_FIELDS} fields`,
    })
    .optional(),
});

export type ValidatedChatRequest = z.infer<typeof chatRequestSchema>;
