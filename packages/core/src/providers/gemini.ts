import {
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type FunctionCall,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
} from '@google/genai';
import type { ProviderConfig, ProviderChatParams, ProviderEffort } from '../types.js';
import type { AIProvider } from './base.js';
import { DEFAULT_MAX_TOKENS, normalizeHistory, toGeminiTools } from './base.js';
import {
  MAX_TOOL_ROUNDS,
  executeToolCall,
  serializeToolResult,
} from './tool-execution.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_EFFORT: ProviderEffort = 'low';
let toolCallSequence = 0;

function createToolCallId() {
  toolCallSequence += 1;
  return `gemini_tool_call_${toolCallSequence}`;
}

const THINKING_LEVELS: Record<ProviderEffort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
  max: ThinkingLevel.HIGH,
};

/** `thinkingLevel` is a Gemini 3 setting; older models use a token budget instead. */
export function geminiSupportsThinkingLevel(model: string): boolean {
  const major = Number(model.match(/gemini-(\d+)/)?.[1] ?? 0);
  return major >= 3;
}

/**
 * Builds the full request history. The API is stateless, so every round sends
 * the whole conversation: normalized stored messages, then any model turns
 * and tool results from earlier rounds of this reply.
 */
function toGeminiContents(params: ProviderChatParams): Content[] {
  const contents = normalizeHistory(params.messages).map((message): Content => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));

  if (contents.length === 0) {
    throw new Error('Cannot send a request with no user message.');
  }

  return contents;
}

/** Text parts only, without thought summaries. */
function visibleText(parts: Part[]): string {
  return parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('');
}

function partsOf(response: GenerateContentResponse): Part[] {
  return response.candidates?.[0]?.content?.parts ?? [];
}

export class GeminiProvider implements AIProvider {
  name = 'gemini';
  private ai: GoogleGenAI;
  private model: string;
  private effort: ProviderEffort;

  constructor(config: ProviderConfig) {
    this.ai = new GoogleGenAI({
      apiKey: config.apiKey,
      ...(config.baseURL ? { httpOptions: { baseUrl: config.baseURL } } : {}),
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.effort = config.effort ?? DEFAULT_EFFORT;
  }

  private config(params: ProviderChatParams): GenerateContentConfig {
    return {
      systemInstruction: params.systemPrompt,
      maxOutputTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(params.temperature != null ? { temperature: params.temperature } : {}),
      ...(params.tools?.length ? { tools: toGeminiTools(params.tools) } : {}),
      ...(geminiSupportsThinkingLevel(this.model)
        ? { thinkingConfig: { thinkingLevel: THINKING_LEVELS[this.effort] } }
        : {}),
      ...(params.signal ? { abortSignal: params.signal } : {}),
    };
  }

  async *chat(params: ProviderChatParams): AsyncGenerator<string> {
    const contents = toGeminiContents(params);
    const config = this.config(params);
    let toolRounds = 0;

    while (true) {
      params.signal?.throwIfAborted();
      const stream = await this.ai.models.generateContentStream({ model: this.model, contents, config });

      // Keep every part the model sent (function calls carry thought signatures
      // that Gemini 3 needs back on the next round).
      const modelParts: Part[] = [];
      const functionCalls: FunctionCall[] = [];

      for await (const chunk of stream) {
        const parts = partsOf(chunk);
        modelParts.push(...parts);

        const text = visibleText(parts);
        if (text) {
          yield text;
        }

        for (const part of parts) {
          if (part.functionCall) functionCalls.push(part.functionCall);
        }
      }

      if (functionCalls.length === 0) {
        return;
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      contents.push({ role: 'model', parts: modelParts });
      contents.push({ role: 'user', parts: await this.runTools(params, functionCalls) });
    }
  }

  async chatSync(params: ProviderChatParams): Promise<string> {
    const contents = toGeminiContents(params);
    const config = this.config(params);
    let toolRounds = 0;
    let text = '';

    while (true) {
      params.signal?.throwIfAborted();
      const response = await this.ai.models.generateContent({ model: this.model, contents, config });
      const parts = partsOf(response);
      text += visibleText(parts);

      const functionCalls = parts
        .map((part) => part.functionCall)
        .filter((call): call is FunctionCall => call !== undefined);

      if (functionCalls.length === 0) {
        return text;
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      contents.push({ role: 'model', parts });
      contents.push({ role: 'user', parts: await this.runTools(params, functionCalls) });
    }
  }

  private async runTools(params: ProviderChatParams, calls: FunctionCall[]): Promise<Part[]> {
    return Promise.all(calls.map(async (call): Promise<Part> => {
      const name = call.name ?? '';
      const id = call.id ?? createToolCallId();
      const result = name
        ? await executeToolCall(params, { id, name, input: call.args ?? {} })
        : { success: false, message: 'The model sent a function call without a name.' };

      return {
        functionResponse: {
          ...(call.id ? { id: call.id } : {}),
          name,
          response: serializeToolResult(result),
        },
      };
    }));
  }
}
