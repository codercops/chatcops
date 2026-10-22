import {
  FinishReason as GeminiFinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
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
import { chatSyncViaTurn, chatViaTurn } from '../agent/chat.js';
import { joinSystem } from '../agent/run-turn.js';
import { DEFAULT_MAX_TOKENS, toGeminiTools } from './base.js';
import { normalizeTurns, type TurnPart } from './history.js';
import type { FinishReason, ProviderEvent, ProviderStepParams } from './types.js';

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

export class GeminiProvider implements AIProvider {
  name = 'gemini';
  private ai: GoogleGenAI;
  readonly model: string;
  private effort: ProviderEffort;

  constructor(config: ProviderConfig) {
    if (!config.apiKey?.trim()) throw new Error('gemini requires apiKey');
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
    params: Pick<ProviderStepParams, 'systemPrompt' | 'systemContext' | 'tools' | 'maxTokens' | 'temperature' | 'signal'>
  ): GenerateContentConfig {
    return {
      systemInstruction: joinSystem(params.systemPrompt, params.systemContext),
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

  /**
   * A turn with tools run through `params.toolExecutor`, as text.
   * @deprecated Use `runTurn()`, which also returns the reply's parts, status and usage.
   */
  chat(params: ProviderChatParams): AsyncGenerator<string> {
    return chatViaTurn(this, params);
  }

  /** @deprecated Use `runTurn()`. */
  chatSync(params: ProviderChatParams): Promise<string> {
    return chatSyncViaTurn(this, params);
  }
}
