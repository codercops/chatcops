import OpenAI from 'openai';
import type { ProviderConfig, ProviderChatParams } from '../types.js';
import type { AIProvider } from './base.js';
import { toProviderMessages, toOpenAITools } from './base.js';

const DEFAULT_MODEL = 'gpt-4o-mini';

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
      ...toProviderMessages(params.messages).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages,
      stream: true,
      max_tokens: params.maxTokens ?? 1024,
      ...(params.tools?.length ? { tools: toOpenAITools(params.tools) } : {}),
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  async chatSync(params: ProviderChatParams): Promise<string> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: params.systemPrompt },
      ...toProviderMessages(params.messages).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      max_tokens: params.maxTokens ?? 1024,
      ...(params.tools?.length ? { tools: toOpenAITools(params.tools) } : {}),
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
    });

    return response.choices[0]?.message?.content ?? '';
  }
}
