import { GoogleGenerativeAI, type Content, type Part } from '@google/generative-ai';
import type { ProviderConfig, ProviderChatParams } from '../types.js';
import type { AIProvider } from './base.js';
import { toProviderMessages, toGeminiTools } from './base.js';
import {
  MAX_TOOL_ROUNDS,
  executeToolCall,
  serializeToolResult,
} from './tool-execution.js';

const DEFAULT_MODEL = 'gemini-2.0-flash';
let toolCallSequence = 0;

function createToolCallId() {
  toolCallSequence += 1;
  return `gemini_tool_call_${toolCallSequence}`;
}

function toGeminiHistory(params: ProviderChatParams): Content[] {
  return toProviderMessages(params.messages)
    .slice(0, -1)
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
}

function getLastMessage(params: ProviderChatParams): string {
  const lastMessage = toProviderMessages(params.messages).at(-1)?.content ?? '';
  if (!lastMessage) {
    throw new Error('Cannot send empty message');
  }

  return lastMessage;
}

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

    const chat = model.startChat({
      history: toGeminiHistory(params),
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? 1024,
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
      },
    });

    let toolRounds = 0;
    let request: string | Part[] = getLastMessage(params);

    while (true) {
      const result = await chat.sendMessageStream(request);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield text;
        }
      }

      const response = await result.response;
      const functionCalls = response.functionCalls() ?? [];
      if (functionCalls.length === 0) {
        return;
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      request = await Promise.all(functionCalls.map(async (call) => {
        const result = await executeToolCall(params, {
          id: createToolCallId(),
          name: call.name,
          input: call.args as Record<string, unknown>,
        });

        return {
          functionResponse: {
            name: call.name,
            response: serializeToolResult(result),
          },
        };
      }));
    }
  }

  async chatSync(params: ProviderChatParams): Promise<string> {
    const model = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: params.systemPrompt,
      ...(params.tools?.length ? { tools: toGeminiTools(params.tools) } : {}),
    });

    const chat = model.startChat({
      history: toGeminiHistory(params),
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? 1024,
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
      },
    });

    let toolRounds = 0;
    let request: string | Part[] = getLastMessage(params);

    while (true) {
      const result = await chat.sendMessage(request);
      const response = result.response;
      const functionCalls = response.functionCalls() ?? [];

      if (functionCalls.length === 0) {
        return response.text();
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      request = await Promise.all(functionCalls.map(async (call) => {
        const toolResult = await executeToolCall(params, {
          id: createToolCallId(),
          name: call.name,
          input: call.args as Record<string, unknown>,
        });

        return {
          functionResponse: {
            name: call.name,
            response: serializeToolResult(toolResult),
          },
        };
      }));
    }
  }
}
