import { z } from 'zod';
import type {
  AIProvider,
  Budgets,
  ChatCopsStorage,
  ChatTool,
  ConversationStore,
  KnowledgeSource,
  LocaleStrings,
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
   */
  budgets?: Budgets;
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
   * @deprecated Use `storage`. A conversation store on its own, as in 0.4.
   * Setting both is an error.
   */
  conversationStore?: ConversationStore;
  /**
   * How long to keep conversations. `purge()` on the handler deletes older
   * ones; call it on a schedule (a cron job, a Workers cron trigger).
   */
  retention?: { conversationsDays?: number };
  /** Allowed CORS origin. Defaults to `'*'`. */
  cors?: string;
  /** @deprecated The server ignores this. Set the widget's text with its `strings` option. */
  i18n?: { defaultLocale: string; locales: Record<string, LocaleStrings> };
}

// Everything in a request can end up in the system prompt, so every field has a ceiling.
export const MAX_USER_DATA_FIELDS = 50;
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
