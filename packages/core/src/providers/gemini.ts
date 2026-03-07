import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ProviderConfig, ProviderChatParams } from '../types.js';
import type { AIProvider } from './base.js';
import { toProviderMessages, toGeminiTools } from './base.js';

const DEFAULT_MODEL = 'gemini-2.0-flash';

export class GeminiProvider implements AIProvider {
  name = 'gemini';
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(config: ProviderConfig) {
    this.genAI = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async *chat(params: ProviderChatParams): AsyncGenerator<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: params.systemPrompt,
      ...(params.tools?.length ? { tools: toGeminiTools(params.tools) } : {}),
    });

    const messages = toProviderMessages(params.messages);
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      history,
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? 1024,
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
      },
    });

    const lastMessage = messages[messages.length - 1]?.content ?? '';
    if (!lastMessage) throw new Error('Cannot send empty message');
    const result = await chat.sendMessageStream(lastMessage);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        yield text;
      }
    }
  }

  async chatSync(params: ProviderChatParams): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: params.systemPrompt,
      ...(params.tools?.length ? { tools: toGeminiTools(params.tools) } : {}),
    });

    const messages = toProviderMessages(params.messages);
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      history,
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? 1024,
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
      },
    });

    const lastMessage = messages[messages.length - 1]?.content ?? '';
    if (!lastMessage) throw new Error('Cannot send empty message');
    const result = await chat.sendMessage(lastMessage);
    return result.response.text();
  }
}
