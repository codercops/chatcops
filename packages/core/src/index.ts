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
export { PROTOCOL_VERSION, encodeSSE, SSE_PING, SSE_DONE, SSE_HEADERS, statusForError, errorBody, describeInvalidRequest, toLegacyChunk, aiSdkEncoder, fromAiSdkRequest, AI_SDK_STREAM_HEADER } from './protocol/index.js';
export type {
  AiSdkChunk,
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
export { createProvider, isAIProvider, normalizeHistory, normalizeTurns, trimHistory, estimateTokens } from './providers/index.js';
export { registerProvider, type ProviderFactory } from './providers/registry.js';
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

// Retrieval
export type {
  Embedder,
  RetrievedChunk,
  RetrievalQuery,
  Retriever,
  Reranker,
  OpenAIEmbedderOptions,
  GeminiEmbedderOptions,
  VoyageEmbedderOptions,
  WorkersAiBinding,
  WorkersAiEmbedderOptions,
  RetrieverKnowledgeOptions,
  VectorRetrieverOptions,
  HybridRetrieverOptions,
} from './retrieval/index.js';
export {
  openaiEmbedder,
  geminiEmbedder,
  voyageEmbedder,
  workersAiEmbedder,
  retrieverKnowledge,
  formatSources,
  uniqueChunks,
  SOURCES_INSTRUCTION,
  vectorRetriever,
  hybridRetriever,
  reciprocalRankFusion,
  retrievalQueryText,
} from './retrieval/index.js';

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
  KeywordQuery,
  MetadataFilter,
  MetadataValue,
  ScoredRecord,
  VectorQuery,
  VectorRecord,
  VectorSource,
  VectorStore,
  MemoryVectorsOptions,
} from './storage/index.js';
export {
  ConflictError,
  isConflictError,
  CONFLICT_ERROR_CODE,
  memoryStorage,
  memoryVectors,
  matchesFilter,
  segmentWords,
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
export { AnalyticsCollector, BufferedEventSink, statsFromSink } from './analytics/index.js';
export type { AnalyticsStats } from './analytics/index.js';

// i18n
export { getLocale, getAvailableLocales } from './i18n/index.js';
export { en, es, hi, fr, de, ja, zh, ar } from './i18n/index.js';
