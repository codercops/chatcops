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

export interface WebhookConfig {
  url: string;
  events: string[];
  secret?: string;
}

export interface ProviderConfig {
  type: 'claude' | 'openai' | 'gemini';
  apiKey: string;
  model?: string;
}

export interface ProviderChatParams {
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface AnalyticsEvent {
  type: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export type { LocaleStrings } from './i18n/types.js';
