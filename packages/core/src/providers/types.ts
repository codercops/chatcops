import type {
  ChatMessage,
  MessagePart,
  ProviderChatParams,
  ProviderMetadata,
  ProviderToolCall,
  TokenUsage,
  ToolDefinition,
} from '../types.js';

/**
 * Why a model step ended.
 * - `stop`: the model finished its reply
 * - `tool-calls`: the model wants tool results before it goes on
 * - `length`: the reply hit the output token limit
 * - `content-filter`: the provider's safety filter stopped the reply
 * - `refusal`: the model declined to answer
 * - `error`: the request failed partway
 */
export type FinishReason = 'stop' | 'tool-calls' | 'length' | 'content-filter' | 'refusal' | 'error';

/** What a provider step yields, in order. Always ends with one `finish`. */
export type ProviderEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  /** Sent once the call's input is complete. */
  | { type: 'tool-call'; call: ProviderToolCall; providerMetadata?: ProviderMetadata }
  | {
      type: 'finish';
      reason: FinishReason;
      usage: TokenUsage;
      /**
       * Everything the model produced in this step, as it should be stored
       * and sent back on the next step: reasoning (with any signatures), text
       * and tool calls, in order.
       */
      parts: MessagePart[];
    };

export interface ProviderStepParams {
  /** Stored history. Messages with `parts` include earlier tool calls and results. */
  messages: ChatMessage[];
  systemPrompt: string;
  tools?: ToolDefinition[];
  maxTokens?: number;
  /** Dropped, with a warning once, for models that don't accept it. */
  temperature?: number;
  signal?: AbortSignal;
}

export interface AIProvider {
  name: string;
  /** The model this provider sends requests to. */
  model?: string;
  /**
   * Runs one model request and yields what comes back, without running any
   * tools. Optional, so custom providers written for 0.4 that only have
   * `chat()` keep working.
   */
  step?(params: ProviderStepParams): AsyncGenerator<ProviderEvent>;
  chat(params: ProviderChatParams): AsyncGenerator<string>;
  chatSync(params: ProviderChatParams): Promise<string>;
}
