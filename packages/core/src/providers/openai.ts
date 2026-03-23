import OpenAI from 'openai';
import type { ProviderConfig, ProviderChatParams } from '../types.js';
import type { AIProvider } from './base.js';
import { toProviderMessages, toOpenAITools } from './base.js';
import {
  MAX_TOOL_ROUNDS,
  executeToolCall,
  parseToolInput,
  serializeToolResult,
  toToolFailure,
} from './tool-execution.js';

const DEFAULT_MODEL = 'gpt-4o-mini';
let toolCallSequence = 0;

function createToolCallId() {
  toolCallSequence += 1;
  return `tool_call_${toolCallSequence}`;
}

export class OpenAIProvider implements AIProvider {
  name = 'openai';
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig) {
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async *chat(params: ProviderChatParams): AsyncGenerator<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...toProviderMessages(params.messages).map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      })),
    ];

    let toolRounds = 0;

    while (true) {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages,
        stream: true,
        max_tokens: params.maxTokens ?? 1024,
        ...(params.tools?.length ? { tools: toOpenAITools(params.tools) } : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
      });

      let finishReason: OpenAI.Chat.Completions.ChatCompletion.Choice['finish_reason'] | null = null;
      let assistantText = '';
      const toolCalls = new Map<number, OpenAI.Chat.ChatCompletionMessageToolCall>();

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
          const existing = toolCalls.get(toolCallDelta.index) ?? {
            id: toolCallDelta.id ?? createToolCallId(),
            type: 'function' as const,
            function: {
              name: '',
              arguments: '',
            },
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

      for (const toolCall of completedToolCalls) {
        const result = await (async () => {
          try {
            return await executeToolCall(params, {
              id: toolCall.id,
              name: toolCall.function.name,
              input: parseToolInput(toolCall.function.arguments),
            });
          } catch (error) {
            return toToolFailure(error);
          }
        })();

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(serializeToolResult(result)),
        });
      }
    }
  }

  async chatSync(params: ProviderChatParams): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...toProviderMessages(params.messages).map((message) => ({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      })),
    ];

    let toolRounds = 0;

    while (true) {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: params.maxTokens ?? 1024,
        ...(params.tools?.length ? { tools: toOpenAITools(params.tools) } : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
      });

      const choice = response.choices[0];
      const assistantMessage = choice?.message;
      const toolCalls = assistantMessage?.tool_calls ?? [];

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

      for (const toolCall of toolCalls) {
        const result = await (async () => {
          try {
            return await executeToolCall(params, {
              id: toolCall.id,
              name: toolCall.function.name,
              input: parseToolInput(toolCall.function.arguments),
            });
          } catch (error) {
            return toToolFailure(error);
          }
        })();

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(serializeToolResult(result)),
        });
      }
    }
  }
}
