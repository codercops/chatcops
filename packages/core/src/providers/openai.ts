import OpenAI from 'openai';
import type { ProviderConfig, ProviderChatParams, ProviderEffort, ToolResult } from '../types.js';
import type { AIProvider } from './base.js';
import { DEFAULT_MAX_TOKENS, normalizeHistory, toOpenAITools, warnOnce } from './base.js';
import {
  MAX_TOOL_ROUNDS,
  executeToolCall,
  parseToolInput,
  serializeToolResult,
  toToolFailure,
} from './tool-execution.js';

const DEFAULT_MODEL = 'gpt-5-mini';
const DEFAULT_EFFORT: ProviderEffort = 'low';
let toolCallSequence = 0;

type FunctionToolCall = OpenAI.Chat.ChatCompletionMessageFunctionToolCall;

function createToolCallId() {
  toolCallSequence += 1;
  return `tool_call_${toolCallSequence}`;
}

/**
 * OpenAI reasoning models (o-series, GPT-5 and later) take `reasoning_effort`
 * and reject a non-default `temperature`. Models behind a custom `baseURL`
 * are treated as regular chat models.
 */
export function isOpenAIReasoningModel(model: string, baseURL?: string): boolean {
  if (baseURL) return false;
  return /^(o\d|gpt-5|gpt-6)/.test(model) && !model.includes('chat-latest');
}

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  private client: OpenAI;
  private model: string;
  private reasoning: boolean;
  private effort: ProviderEffort;
  private maxTokensParam: 'max_completion_tokens' | 'max_tokens';

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.organization ? { organization: config.organization } : {}),
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.reasoning = isOpenAIReasoningModel(this.model, config.baseURL);
    this.effort = config.effort ?? DEFAULT_EFFORT;
    this.maxTokensParam = config.maxTokensParam ?? 'max_completion_tokens';
  }

  private request(params: ProviderChatParams, messages: OpenAI.Chat.ChatCompletionMessageParam[]) {
    let temperature = params.temperature;
    if (temperature != null && this.reasoning) {
      warnOnce(
        `openai-temperature-${this.model}`,
        `${this.model} doesn't accept \`temperature\`, so it is not sent. Use \`effort\` to trade speed for depth.`
      );
      temperature = undefined;
    }

    return {
      model: this.model,
      messages,
      [this.maxTokensParam]: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(params.tools?.length ? { tools: toOpenAITools(params.tools) } : {}),
      ...(temperature != null ? { temperature } : {}),
      ...(this.reasoning ? { reasoning_effort: this.effort } : {}),
    };
  }

  private toMessages(params: ProviderChatParams): OpenAI.Chat.ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: params.systemPrompt },
      ...normalizeHistory(params.messages).map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];
  }

  async *chat(params: ProviderChatParams): AsyncGenerator<string> {
    const messages = this.toMessages(params);
    let toolRounds = 0;

    while (true) {
      params.signal?.throwIfAborted();
      const stream = await this.client.chat.completions.create(
        { ...this.request(params, messages), stream: true },
        { signal: params.signal }
      );

      let finishReason: OpenAI.Chat.Completions.ChatCompletion.Choice['finish_reason'] | null = null;
      let assistantText = '';
      const toolCalls = new Map<number, FunctionToolCall>();

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        finishReason = choice.finish_reason ?? finishReason;

        const deltaText = choice.delta?.content;
        if (deltaText) {
          assistantText += deltaText;
          yield deltaText;
        }

        for (const toolCallDelta of choice.delta?.tool_calls ?? []) {
          if (toolCallDelta.type && toolCallDelta.type !== 'function') continue;

          const existing = toolCalls.get(toolCallDelta.index) ?? {
            id: toolCallDelta.id ?? createToolCallId(),
            type: 'function' as const,
            function: { name: '', arguments: '' },
          };

          if (toolCallDelta.id) {
            existing.id = toolCallDelta.id;
          }
          if (toolCallDelta.function?.name) {
            existing.function.name = toolCallDelta.function.name;
          }
          if (toolCallDelta.function?.arguments) {
            existing.function.arguments += toolCallDelta.function.arguments;
          }

          toolCalls.set(toolCallDelta.index, existing);
        }
      }

      const completedToolCalls = Array.from(toolCalls.entries())
        .sort(([left], [right]) => left - right)
        .map(([, toolCall]) => toolCall);

      if (finishReason === 'length') {
        console.warn('[chatcops] OpenAI reply cut off at the token limit. Raise `maxTokens` if this keeps happening.');
      }

      if (finishReason !== 'tool_calls' || completedToolCalls.length === 0) {
        return;
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      messages.push({
        role: 'assistant',
        content: assistantText || null,
        tool_calls: completedToolCalls,
      });
      messages.push(...await this.runTools(params, completedToolCalls));
    }
  }

  async chatSync(params: ProviderChatParams): Promise<string> {
    const messages = this.toMessages(params);
    let toolRounds = 0;

    while (true) {
      params.signal?.throwIfAborted();
      const response = await this.client.chat.completions.create(this.request(params, messages), { signal: params.signal });

      const choice = response.choices[0];
      const assistantMessage = choice?.message;
      const toolCalls = (assistantMessage?.tool_calls ?? []).filter(
        (toolCall): toolCall is FunctionToolCall => toolCall.type === 'function'
      );

      if (choice?.finish_reason !== 'tool_calls' || toolCalls.length === 0) {
        return assistantMessage?.content ?? '';
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      messages.push({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: toolCalls,
      });
      messages.push(...await this.runTools(params, toolCalls));
    }
  }

  /** Runs tool calls in parallel and returns the tool messages in call order. */
  private async runTools(
    params: ProviderChatParams,
    toolCalls: FunctionToolCall[]
  ): Promise<OpenAI.Chat.ChatCompletionToolMessageParam[]> {
    return Promise.all(toolCalls.map(async (toolCall) => {
      let result: ToolResult;
      try {
        result = await executeToolCall(params, {
          id: toolCall.id,
          name: toolCall.function.name,
          input: parseToolInput(toolCall.function.arguments),
        });
      } catch (error) {
        result = toToolFailure(error);
      }

      return {
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        content: JSON.stringify(serializeToolResult(result)),
      };
    }));
  }
}
