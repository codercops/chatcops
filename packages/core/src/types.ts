export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface Conversation {
  id: string;
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  required: string[];
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
  type: 'claude' | 'openai' | 'gemini';
  apiKey: string;
  model?: string;
  /**
   * Custom API endpoint, for proxies and OpenAI-compatible servers
   * (Ollama, vLLM, Groq, OpenRouter). Passed to the provider SDK as is.
   */
  baseURL?: string;
  /** OpenAI organization id. Ignored by other providers. */
  organization?: string;
  /**
   * Reply effort for models that support it (Claude 4.6+, OpenAI reasoning
   * models, Gemini thinking models). Defaults to `'low'`, which suits chat.
   * Ignored by models without an effort setting.
   */
  effort?: ProviderEffort;
  /**
   * OpenAI only: the name of the output token limit sent to the API.
   * Defaults to `'max_completion_tokens'`. Set `'max_tokens'` for
   * OpenAI-compatible servers that only accept the old name.
   */
  maxTokensParam?: 'max_completion_tokens' | 'max_tokens';
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
