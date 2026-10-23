export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /**
   * The message text. For a message with `parts`, this is the text parts
   * joined, kept so older stores and widgets that only know `content` work.
   */
  content: string;
  /**
   * What the message is made of: text, tool calls and their results, sources.
   * Messages saved by older versions have no parts; read them with
   * `partsOf(message)`, which treats `content` as one text part.
   */
  parts?: MessagePart[];
  /**
   * `incomplete` is a reply that stopped early (a provider error, max tokens).
   * `aborted` is a reply the visitor walked away from. Neither is sent back to
   * the model as if it were a finished answer. Missing means complete.
   */
  status?: 'complete' | 'incomplete' | 'aborted';
  /** Tokens the reply used. Assistant messages only. */
  usage?: TokenUsage;
  /** True on replies a model wrote, for machine-readable AI marking. */
  aiGenerated?: boolean;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
  /**
   * Goes up by one on every write, for stores that check for conflicting
   * writes. Missing on conversations from stores that don't track it.
   */
  version?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Input tokens read from the provider's prompt cache. */
  cacheReadTokens?: number;
  /** Input tokens written to the provider's prompt cache. */
  cacheWriteTokens?: number;
}

/**
 * Data a provider needs back on the next request but nobody else reads, keyed
 * by provider name. For example Claude's thinking signatures or Gemini's
 * thought signatures. Store it as is and never show it.
 */
export type ProviderMetadata = Record<string, Record<string, unknown>>;

/** A JSON Schema object (draft 2020-12). Providers each accept a subset. */
export type JSONSchema = Record<string, unknown>;

export type ToolExecutor = 'server' | 'client' | 'mcp';

export type ToolCallState = 'pending' | 'awaiting-approval' | 'done' | 'error' | 'expired';

export interface TextPart {
  type: 'text';
  text: string;
  providerMetadata?: ProviderMetadata;
}

/** The model's reasoning. Kept for the provider, never shown to visitors. */
export interface ReasoningPart {
  type: 'reasoning';
  text: string;
  providerMetadata?: ProviderMetadata;
}

export interface SourcePart {
  type: 'source';
  sourceId: string;
  url: string;
  title?: string;
  snippet?: string;
}

export interface ToolCallPart {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
  executor: ToolExecutor;
  state: ToolCallState;
  providerMetadata?: ProviderMetadata;
}

export interface ToolResultPart {
  type: 'tool-result';
  toolCallId: string;
  toolName: string;
  output?: unknown;
  error?: string;
}

export interface LeadCapturedPart {
  type: 'lead-captured';
  lead: Record<string, unknown>;
}

export interface HandoffPart {
  type: 'handoff';
  status: 'requested' | 'queued' | 'connected' | 'ended';
  provider?: string;
}

/**
 * One piece of a message. An assistant message for a turn with tool calls
 * holds every step in order: reasoning, text and tool calls, then the tool
 * results, then the next step.
 */
export type MessagePart =
  | TextPart
  | ReasoningPart
  | SourcePart
  | ToolCallPart
  | ToolResultPart
  | LeadCapturedPart
  | HandoffPart;

export interface ChatRequest {
  conversationId: string;
  message: string;
  pageContext?: PageContext;
  locale?: string;
}

export interface ChatResponse {
  message: ChatMessage;
  leadCaptured?: boolean;
  suggestedActions?: string[];
}

export interface PageContext {
  url: string;
  title: string;
  description?: string;
  contentSnippet?: string;
}

export interface LeadData {
  name: string;
  email: string;
  company?: string;
  phone?: string;
  projectDetails: string;
  source: string;
  metadata?: Record<string, unknown>;
}

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
  enum?: string[];
}

/** Hints about what a tool does, in the shape MCP uses. Not enforced. */
export interface ToolAnnotations {
  title?: string;
  /** The tool only reads; calling it changes nothing. */
  readOnlyHint?: boolean;
  /** The tool can change or delete something that matters. */
  destructiveHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  /**
   * JSON Schema for the tool's input. The root must be `type: 'object'`.
   * Nested objects, arrays, `enum`, `anyOf` and `$ref` all work.
   */
  inputSchema?: JSONSchema;
  /** The 0.4 flat form, used when there's no `inputSchema`. */
  parameters?: Record<string, ToolParameter>;
  /** Required keys of `parameters`. Ignored with `inputSchema`, which has its own `required`. */
  required?: string[];
  annotations?: ToolAnnotations;
}

/** What a running tool gets besides its input. */
export interface ToolContext {
  conversationId: string;
  /** Aborts when the visitor leaves or the tool times out. */
  signal: AbortSignal;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  message?: string;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type ProviderToolExecutor = (call: ProviderToolCall) => Promise<ToolResult>;

export interface WebhookConfig {
  url: string;
  events: string[];
  /** Signs each delivery; check it with `verifyWebhook` from `@chatcops/server`. */
  secret?: string;
  /**
   * Allows http and hosts on loopback, private or link-local networks, which
   * are refused by default. Use it for a local receiver during development.
   */
  allowPrivateNetwork?: boolean;
}

/** How much effort a model spends on each reply. Lower is faster and cheaper. */
export type ProviderEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ProviderConfig {
  type: 'claude' | 'openai' | 'gemini' | 'openai-compatible' | (string & {});
  /** Required for the hosted providers; optional for openai-compatible and custom providers. */
  apiKey?: string;
  model?: string;
  /**
   * Custom API endpoint, for proxies and OpenAI-compatible servers
   * (Ollama, vLLM, Groq, OpenRouter). Passed to the provider SDK as is.
   */
  baseURL?: string;
  /** Extra request headers for OpenAI and OpenAI-compatible endpoints. */
  headers?: Record<string, string>;
  /** OpenAI providers: omit tools when false. Defaults to true. */
  supportsTools?: boolean;
  /** OpenAI organization id. Ignored by other providers. */
  organization?: string;
  /**
   * Reply effort for models that support it (Claude 4.6+, OpenAI reasoning
   * models, Gemini thinking models). Defaults to `'low'`, which suits chat.
   * Ignored by models without an effort setting.
   */
  effort?: ProviderEffort;
  /**
   * OpenAI providers: the name of the output token limit sent to the API.
   * Defaults to `'max_completion_tokens'` for openai and `'max_tokens'`
   * for openai-compatible.
   */
  maxTokensParam?: 'max_completion_tokens' | 'max_tokens';
  /**
   * The `fetch` the provider SDK sends requests with. Defaults to the global
   * one. Set it to route requests through a proxy or to replay recorded
   * responses in tests.
   */
  fetch?: typeof fetch;
  /**
   * Claude only: mark the system prompt and tools as a cached prefix, so
   * later requests read them from the prompt cache at a tenth of the price.
   * On by default. Prompts shorter than the model's minimum aren't cached
   * either way.
   */
  promptCaching?: boolean;
}

export interface ProviderChatParams {
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: ToolDefinition[];
  toolExecutor?: ProviderToolExecutor;
  toolTimeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  /**
   * Aborts the reply, for example when the visitor disconnects. The provider
   * request is cancelled and no further tool rounds start.
   */
  signal?: AbortSignal;
}

export interface AnalyticsEvent {
  type: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export type { LocaleStrings } from './i18n/types.js';
