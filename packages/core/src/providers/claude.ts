import Anthropic from '@anthropic-ai/sdk';
import type { ProviderConfig, ProviderChatParams } from '../types.js';
import type { AIProvider } from './base.js';
import { toProviderMessages, toClaudeTools } from './base.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export class ClaudeProvider implements AIProvider {
  name = 'claude';
  private client: Anthropic;
  private model: string;

  constructor(config: ProviderConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async *chat(params: ProviderChatParams): AsyncGenerator<string> {
    const messages = toProviderMessages(params.messages).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

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
  }

  async chatSync(params: ProviderChatParams): Promise<string> {
    const messages = toProviderMessages(params.messages).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: params.maxTokens ?? 1024,
      system: params.systemPrompt,
      messages,
      ...(params.tools?.length ? { tools: toClaudeTools(params.tools) } : {}),
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    return textBlock?.type === 'text' ? textBlock.text : '';
  }
}
