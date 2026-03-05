// Types
export type {
  ChatMessage,
  Conversation,
  ChatRequest,
  ChatResponse,
  PageContext,
  LeadData,
  ToolParameter,
  ToolDefinition,
  ToolResult,
  WebhookConfig,
  ProviderConfig,
  ProviderChatParams,
  AnalyticsEvent,
  LocaleStrings,
} from './types.js';

// Providers
export type { AIProvider } from './providers/index.js';
export { createProvider, ClaudeProvider, OpenAIProvider, GeminiProvider } from './providers/index.js';

// Tools
export type { ChatTool, LeadCaptureCallback } from './tools/index.js';
export { toolToDefinition, LeadCaptureTool } from './tools/index.js';

// Knowledge
export type { KnowledgeSource, FAQPair } from './knowledge/index.js';
export { TextKnowledgeSource, FAQKnowledgeSource } from './knowledge/index.js';

// Conversation
export type { ConversationStore } from './conversation/index.js';
export { ConversationManager, MemoryStore } from './conversation/index.js';

// Analytics
export { AnalyticsCollector } from './analytics/index.js';
export type { AnalyticsStats } from './analytics/index.js';

// i18n
export { getLocale, getAvailableLocales } from './i18n/index.js';
export { en, es, hi, fr, de, ja, zh, ar } from './i18n/index.js';
