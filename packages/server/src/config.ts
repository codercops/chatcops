import { z } from 'zod';
import type { ChatTool, KnowledgeSource, WebhookConfig, ProviderConfig, LocaleStrings } from '@chatcops/core';

export interface ChatCopsServerConfig {
  provider: ProviderConfig;
  systemPrompt: string;
  tools?: ChatTool[];
  knowledge?: KnowledgeSource[];
  rateLimit?: { maxRequests: number; windowMs: number };
  webhooks?: WebhookConfig[];
  analytics?: boolean;
  cors: string;
  i18n?: { defaultLocale: string; locales: Record<string, LocaleStrings> };
}

export const chatRequestSchema = z.object({
  conversationId: z.string().min(1).max(128),
  message: z.string().min(1).max(10000),
  pageContext: z.object({
    url: z.string().url(),
    title: z.string().max(500),
    description: z.string().max(1000).optional(),
    contentSnippet: z.string().max(2000).optional(),
  }).optional(),
  locale: z.string().max(10).optional(),
});

export type ValidatedChatRequest = z.infer<typeof chatRequestSchema>;
