import {
  FinishReason as GeminiFinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type FunctionCall,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type GenerateContentResponseUsageMetadata,
  type Part,
} from '@google/genai';
import type {
  ChatMessage,
  MessagePart,
  ProviderChatParams,
  ProviderConfig,
  ProviderEffort,
  ReasoningPart,
  TextPart,
  TokenUsage,
  ToolCallPart,
} from '../types.js';
import type { AIProvider } from './base.js';
import { DEFAULT_MAX_TOKENS, normalizeHistory, toGeminiTools } from './base.js';
import { normalizeTurns, type TurnPart } from './history.js';
import type { FinishReason, ProviderEvent, ProviderStepParams } from './types.js';
import {
  MAX_TOOL_ROUNDS,
  executeToolCall,
  serializeToolResult,
} from './tool-execution.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const DEFAULT_EFFORT: ProviderEffort = 'low';

function createToolCallId() {
  return `gemini_call_${crypto.randomUUID()}`;
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

/** What a stored part needs to go back to Gemini. */
interface GeminiPartMetadata {
  thoughtSignature?: string;
  /** The id was made up here because the API sent none, so it isn't sent back. */
  syntheticId?: boolean;
}

function geminiMetadata(part: TurnPart): GeminiPartMetadata | undefined {
  return 'providerMetadata' in part ? (part.providerMetadata?.gemini as GeminiPartMetadata | undefined) : undefined;
}

/**
 * Gemini 3 wants a thought signature on the first function call of each
 * step. Calls that came from another provider have none, and Google
 * documents this value for that case.
 */
const PLACEHOLDER_SIGNATURE = 'skip_thought_signature_validator';

/**
 * Stored history as Gemini contents. An assistant message with tool calls
 * becomes a model turn with its `functionCall` parts, then a user turn with
 * the `functionResponse` parts, for each step. Thought signatures go back on
 * the parts they came with.
 */
export function toGeminiStepContents(messages: ChatMessage[], model = DEFAULT_MODEL): Content[] {
  const contents: Content[] = [];
  const needsSignature = geminiSupportsThinkingLevel(model);
  const synthetic = new Set<string>();

  const push = (role: 'user' | 'model', parts: Part[]) => {
    if (parts.length === 0) return;
    const last = contents.at(-1);
    if (last?.role === role) last.parts = [...(last.parts ?? []), ...parts];
    else contents.push({ role, parts });
  };

  for (const turn of normalizeTurns(messages)) {
    let role: 'user' | 'model' = turn.role === 'assistant' ? 'model' : 'user';
    let run: Part[] = [];
    let signedCall = false;

    for (const part of turn.parts) {
      const partRole = part.type === 'tool-result' ? 'user' : turn.role === 'assistant' ? 'model' : 'user';
      if (partRole !== role) {
        push(role, run);
        run = [];
        role = partRole;
        signedCall = false;
      }
      const meta = geminiMetadata(part);
      const signature = meta?.thoughtSignature ? { thoughtSignature: meta.thoughtSignature } : {};

      switch (part.type) {
        case 'text':
          run.push({ text: part.text, ...signature });
          break;
        case 'reasoning':
          // Thoughts from another provider mean nothing to Gemini.
          if (meta) run.push({ text: part.text, thought: true, ...signature });
          break;
        case 'tool-call': {
          if (meta?.syntheticId) synthetic.add(part.toolCallId);
          const args = typeof part.input === 'object' && part.input !== null && !Array.isArray(part.input)
            ? (part.input as Record<string, unknown>)
            : {};
          const placeholder = needsSignature && !signedCall && !meta?.thoughtSignature
            ? { thoughtSignature: PLACEHOLDER_SIGNATURE }
            : {};
          signedCall = true;
          run.push({
            functionCall: { ...(meta?.syntheticId ? {} : { id: part.toolCallId }), name: part.toolName, args },
            ...signature,
            ...placeholder,
          });
          break;
        }
        case 'tool-result':
          run.push({
            functionResponse: {
              ...(synthetic.has(part.toolCallId) ? {} : { id: part.toolCallId }),
              name: part.toolName,
              response: (part.output as Record<string, unknown> | undefined) ?? { success: false, message: part.error },
            },
          });
          break;
      }
    }
    push(role, run);
  }

  if (contents.length === 0) {
    throw new Error('Cannot send a request with no user message.');
  }
  return contents;
}

const CONTENT_FILTERED = new Set<string>([
  GeminiFinishReason.SAFETY,
  GeminiFinishReason.RECITATION,
  GeminiFinishReason.BLOCKLIST,
  GeminiFinishReason.PROHIBITED_CONTENT,
  GeminiFinishReason.SPII,
  GeminiFinishReason.IMAGE_SAFETY,
  GeminiFinishReason.IMAGE_PROHIBITED_CONTENT,
]);

function finishReason(reason: string | undefined, blocked: boolean, hasToolCalls: boolean): FinishReason {
  if (blocked || (reason && CONTENT_FILTERED.has(reason))) return 'content-filter';
  if (reason === GeminiFinishReason.MAX_TOKENS) return 'length';
  if (reason === GeminiFinishReason.MALFORMED_FUNCTION_CALL || reason === GeminiFinishReason.UNEXPECTED_TOOL_CALL) return 'error';
  if (hasToolCalls) return 'tool-calls';
  return 'stop';
}

/** Thinking tokens are billed as output, so they count as output here. */
function toUsage(usage: GenerateContentResponseUsageMetadata | undefined): TokenUsage {
  const cached = usage?.cachedContentTokenCount ?? 0;
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    ...(cached ? { cacheReadTokens: cached } : {}),
  };
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
  readonly model: string;
  private effort: ProviderEffort;

  constructor(config: ProviderConfig) {
    this.ai = new GoogleGenAI({
      apiKey: config.apiKey,
      ...(config.baseURL || config.fetch
        ? {
            httpOptions: {
              ...(config.baseURL ? { baseUrl: config.baseURL } : {}),
              ...(config.fetch ? { fetch: config.fetch } : {}),
            },
          }
        : {}),
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.effort = config.effort ?? DEFAULT_EFFORT;
  }

  private config(
    params: Pick<ProviderStepParams, 'systemPrompt' | 'tools' | 'maxTokens' | 'temperature' | 'signal'>
  ): GenerateContentConfig {
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

  /** One model request: streams text and thoughts, then reports tool calls, usage and why it stopped. */
  async *step(params: ProviderStepParams): AsyncGenerator<ProviderEvent> {
    params.signal?.throwIfAborted();
    const stream = await this.ai.models.generateContentStream({
      model: this.model,
      contents: toGeminiStepContents(params.messages, this.model),
      config: this.config(params),
    });

    const parts: MessagePart[] = [];
    const calls: ToolCallPart[] = [];
    // Text and thoughts arrive in pieces. A signature ends the part it's on.
    let current: TextPart | ReasoningPart | null = null;
    let reason: string | undefined;
    let blocked = false;
    let usage: GenerateContentResponseUsageMetadata | undefined;

    for await (const chunk of stream) {
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      if (chunk.promptFeedback?.blockReason) blocked = true;
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) reason = candidate.finishReason;

      for (const part of candidate?.content?.parts ?? []) {
        const signature = part.thoughtSignature;

        if (part.functionCall) {
          current = null;
          const call = part.functionCall;
          const syntheticId = !call.id;
          const meta: GeminiPartMetadata = {
            ...(signature ? { thoughtSignature: signature } : {}),
            ...(syntheticId ? { syntheticId: true } : {}),
          };
          const toolCall: ToolCallPart = {
            type: 'tool-call',
            toolCallId: call.id ?? createToolCallId(),
            toolName: call.name ?? '',
            input: call.args ?? {},
            executor: 'server',
            state: 'pending',
            ...(Object.keys(meta).length ? { providerMetadata: { gemini: { ...meta } } } : {}),
          };
          parts.push(toolCall);
          calls.push(toolCall);
          continue;
        }

        if (typeof part.text === 'string') {
          const kind = part.thought ? 'reasoning' : 'text';
          if (!current || current.type !== kind) {
            const next: TextPart | ReasoningPart = kind === 'text' ? { type: 'text', text: '' } : { type: 'reasoning', text: '' };
            parts.push(next);
            current = next;
          }
          current.text += part.text;
          if (part.text) yield { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', delta: part.text };
        }

        if (signature) {
          const target: MessagePart | undefined = current ?? parts.at(-1);
          if (target && (target.type === 'text' || target.type === 'reasoning')) {
            target.providerMetadata = { gemini: { thoughtSignature: signature } };
          }
          current = null;
        }
      }
    }
    params.signal?.throwIfAborted();

    for (const call of calls) {
      yield {
        type: 'tool-call',
        call: { id: call.toolCallId, name: call.toolName, input: call.input as Record<string, unknown> },
        ...(call.toolName ? {} : { inputError: 'The model sent a function call without a name.' }),
      };
    }

    yield {
      type: 'finish',
      reason: finishReason(reason, blocked, calls.length > 0),
      usage: toUsage(usage),
      parts: parts.filter((part) => part.type !== 'text' || part.text !== '' || part.providerMetadata),
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
