import { z } from 'zod';
import type { ChatTool, KnowledgeSource, WebhookConfig, ProviderConfig, LocaleStrings } from '@chatcops/core';

export interface ChatCopsServerConfig {
  provider: ProviderConfig;
  systemPrompt: string;
  tools?: ChatTool[];
  toolTimeoutMs?: number;
  knowledge?: KnowledgeSource[];
  rateLimit?: { maxRequests: number; windowMs: number };
  webhooks?: WebhookConfig[];
  analytics?: boolean;
  cors: string;
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
  regenerate: z.boolean().optional(),
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
