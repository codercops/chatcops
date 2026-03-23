import Anthropic from '@anthropic-ai/sdk';
import type { ProviderConfig, ProviderChatParams } from '../types.js';
import type { AIProvider } from './base.js';
import { toProviderMessages, toClaudeTools } from './base.js';
import {
  MAX_TOOL_ROUNDS,
  executeToolCall,
  serializeToolResult,
} from './tool-execution.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function toClaudeMessages(params: ProviderChatParams): Anthropic.Messages.MessageParam[] {
  return toProviderMessages(params.messages).map((message) => ({
    role: message.role as 'user' | 'assistant',
    content: message.content,
  }));
}

function toAssistantContentBlocks(
  content: Anthropic.Messages.Message['content']
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [];

  for (const block of content) {
    if (block.type === 'text') {
      blocks.push({ type: 'text', text: block.text });
      continue;
    }

    if (block.type === 'tool_use') {
      blocks.push({
        type: 'tool_use',
        id: block.id,
        name: block.name,
        input: block.input,
      });
    }
  }

  return blocks;
}

export class ClaudeProvider implements AIProvider {
  name = 'claude';
  private client: Anthropic;
  private model: string;

  constructor(config: ProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async *chat(params: ProviderChatParams): AsyncGenerator<string> {
    const messages = toClaudeMessages(params);
    let toolRounds = 0;

    while (true) {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: params.maxTokens ?? 1024,
        system: params.systemPrompt,
        messages,
        ...(params.tools?.length ? { tools: toClaudeTools(params.tools) } : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }

      const message = await stream.finalMessage();
      const toolUses = message.content.filter((block) => block.type === 'tool_use');

      if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
        return;
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      messages.push({
        role: 'assistant',
        content: toAssistantContentBlocks(message.content),
      });

      const toolResults = await Promise.all(toolUses.map(async (toolUse) => {
        const result = await executeToolCall(params, {
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
        });

        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: JSON.stringify(serializeToolResult(result)),
          is_error: !result.success,
        };
      }));

      messages.push({
        role: 'user',
        content: toolResults,
      });
    }
  }

  async chatSync(params: ProviderChatParams): Promise<string> {
    const messages = toClaudeMessages(params);
    let toolRounds = 0;

    while (true) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: params.maxTokens ?? 1024,
        system: params.systemPrompt,
        messages,
        ...(params.tools?.length ? { tools: toClaudeTools(params.tools) } : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
      });

      const toolUses = response.content.filter((block) => block.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        return response.content
          .filter((block) => block.type === 'text')
          .map((block) => block.text)
          .join('');
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      messages.push({
        role: 'assistant',
        content: toAssistantContentBlocks(response.content),
      });

      const toolResults = await Promise.all(toolUses.map(async (toolUse) => {
        const result = await executeToolCall(params, {
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
        });

        return {
          type: 'tool_result' as const,
          tool_use_id: toolUse.id,
          content: JSON.stringify(serializeToolResult(result)),
          is_error: !result.success,
        };
      }));

      messages.push({
        role: 'user',
        content: toolResults,
      });
    }
  }
}
