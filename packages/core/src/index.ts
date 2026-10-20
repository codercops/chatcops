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
  ProviderToolCall,
  ProviderToolExecutor,
  WebhookConfig,
  ProviderConfig,
  ProviderEffort,
  ProviderChatParams,
  AnalyticsEvent,
  LocaleStrings,
  TokenUsage,
  ProviderMetadata,
  JSONSchema,
  ToolExecutor,
  ToolCallState,
  MessagePart,
  TextPart,
  ReasoningPart,
  SourcePart,
  ToolCallPart,
  ToolResultPart,
  LeadCapturedPart,
  HandoffPart,
} from './types.js';
export { partsOf, messageText } from './parts.js';

// Wire protocol
export { PROTOCOL_VERSION } from './protocol/index.js';
export type {
  WirePart,
  WirePartType,
  WireErrorCode,
  WireFinishReason,
  WireAgent,
  WireErrorBody,
  ChatRequestV1,
  ClientToolManifest,
} from './protocol/index.js';

// Providers
export type { AIProvider, NormalizedMessage, FinishReason, ProviderEvent, ProviderStepParams } from './providers/index.js';
export { createProvider, normalizeHistory, ClaudeProvider, OpenAIProvider, GeminiProvider } from './providers/index.js';

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
