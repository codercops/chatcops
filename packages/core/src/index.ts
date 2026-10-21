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
  ToolAnnotations,
  ToolContext,
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
export { PROTOCOL_VERSION, statusForError, errorBody, describeInvalidRequest, toLegacyChunk } from './protocol/index.js';
export type {
  LegacyChunk,
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
export type {
  AIProvider,
  NormalizedMessage,
  NormalizedTurn,
  TurnPart,
  FinishReason,
  ProviderEvent,
  ProviderStepParams,
} from './providers/index.js';
export { createProvider, isAIProvider, normalizeHistory, normalizeTurns, trimHistory, estimateTokens, ClaudeProvider, OpenAIProvider, GeminiProvider } from './providers/index.js';
export { toolInputSchema, legacyParametersToSchema, validateTools, ToolDefinitionError } from './providers/index.js';

// Turn engine
export {
  runTurn,
  DEFAULT_MAX_STEPS,
  toolRegistry,
  executorRegistry,
  toolOutput,
  MAX_TOOL_OUTPUT_CHARS,
  RefusalError,
  ContentFilterError,
  MaxStepsError,
} from './agent/index.js';
export type { RunTurnOptions, TurnResult, ToolRegistry, ToolRunContext } from './agent/index.js';

// Tools
export type { ChatTool, LeadCaptureCallback } from './tools/index.js';
export { toolToDefinition, LeadCaptureTool } from './tools/index.js';

// Knowledge
export type { KnowledgeSource, FAQPair } from './knowledge/index.js';
export { TextKnowledgeSource, FAQKnowledgeSource } from './knowledge/index.js';

// Conversation
export type { ConversationStore } from './conversation/index.js';
export { ConversationManager, MemoryStore } from './conversation/index.js';
export type { ConversationManagerOptions, ReleaseTurn } from './conversation/index.js';

// Storage
export type {
  AppendOptions,
  ChatCopsStorage,
  ConversationSummary,
  CounterStore,
  CounterValue,
  EventCount,
  EventQuery,
  EventSink,
  KeyValueStore,
  ListQuery,
  MemoryStorageOptions,
  ConversationStoreWithAppend,
} from './storage/index.js';
export {
  ConflictError,
  isConflictError,
  CONFLICT_ERROR_CODE,
  memoryStorage,
  withAppend,
  isLegacyConversationStore,
} from './storage/index.js';

// Budgets
export { createBudgetGuard, BudgetExceededError, DEFAULT_BUDGETS, withDefaultBudgets } from './limits/budget.js';
export type { Budgets, BudgetLimit, BudgetContext, BudgetGuard, BudgetScope } from './limits/budget.js';

// Rate limiting
export { createRateLimiter } from './limits/rate-limit.js';
export type { RateLimitRule, RateLimitResult, RateLimiterOptions } from './limits/rate-limit.js';

// Analytics
export { AnalyticsCollector } from './analytics/index.js';
export type { AnalyticsStats } from './analytics/index.js';

// i18n
export { getLocale, getAvailableLocales } from './i18n/index.js';
export { en, es, hi, fr, de, ja, zh, ar } from './i18n/index.js';
