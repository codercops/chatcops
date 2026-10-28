import type { RetrievedChunk } from '../retrieval/types.js';
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
  /**
   * Sent once the call's input is complete. `inputError` is set when the
   * model sent input that isn't a JSON object; the call then can't run, and
   * the error goes back to the model as the tool's result.
   */
  | { type: 'tool-call'; call: ProviderToolCall; providerMetadata?: ProviderMetadata; inputError?: string }
  /** A provider with native citations cited `sources[index]`. */
  | { type: 'source'; index: number }
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
  /** The operator's instructions. The same on every request, so providers can cache it. */
  systemPrompt: string;
  /**
   * Instructions that change per request (knowledge base excerpts, the
   * visitor's language), sent after `systemPrompt` and outside the cached
   * prefix.
   */
  systemContext?: string;
  tools?: ToolDefinition[];
  /**
   * Retrieved chunks, only for providers with `citations: 'native'`, which
   * send them as their own content and report citations as `source` events.
   * Other providers get them as text in `systemContext`.
   */
  sources?: RetrievedChunk[];
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
   * `native`: the provider takes `sources` on step params and reports what
   * the model cited. Without it, sources go in the system context and
   * citations are read from `[n]` markers in the text.
   */
  citations?: 'native';
  /**
   * Runs one model request and yields what comes back, without running any
   * tools. Every built-in provider has it. A provider needs `step()` or
   * `chat()`.
   */
  step?(params: ProviderStepParams): AsyncGenerator<ProviderEvent>;
  /**
   * The text of a whole turn, running tools through `params.toolExecutor`
   * itself. For custom providers written before `step()`; one that has
   * `step()` doesn't need it.
   */
  chat?(params: ProviderChatParams): AsyncGenerator<string>;
}
