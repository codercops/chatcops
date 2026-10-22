import OpenAI from 'openai';
import type {
  ChatMessage,
  MessagePart,
  ProviderChatParams,
  ProviderConfig,
  ProviderEffort,
  TokenUsage,
} from '../types.js';
import type { AIProvider } from './base.js';
import { chatSyncViaTurn, chatViaTurn } from '../agent/chat.js';
import { joinSystem } from '../agent/run-turn.js';
import { DEFAULT_MAX_TOKENS, toOpenAITools, warnOnce } from './base.js';
import { normalizeTurns } from './history.js';
import type { FinishReason, ProviderEvent, ProviderStepParams } from './types.js';
import { parseToolInput } from './tool-execution.js';

const DEFAULT_MODEL = 'gpt-5-mini';
const DEFAULT_EFFORT: ProviderEffort = 'low';

function createToolCallId() {
  return `call_${crypto.randomUUID()}`;
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

type MessageParam = OpenAI.Chat.ChatCompletionMessageParam;

/**
 * Stored history as OpenAI chat messages: the system prompt first, then for
 * each step an assistant message with its `tool_calls`, followed by one
 * `tool` message per result in call order. Reasoning isn't sent back; the
 * chat completions API has no field for it.
 */
export function toOpenAIStepMessages(systemPrompt: string, messages: ChatMessage[]): MessageParam[] {
  const out: MessageParam[] = [{ role: 'system', content: systemPrompt }];

  for (const turn of normalizeTurns(messages)) {
    if (turn.role === 'user') {
      for (const part of turn.parts) {
        if (part.type === 'tool-result') out.push(toToolMessage(part));
      }
      const text = turn.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n\n');
      if (text) out.push({ role: 'user', content: text });
      continue;
    }

    let text = '';
    let calls: OpenAI.Chat.ChatCompletionMessageFunctionToolCall[] = [];
    const flush = () => {
      if (text || calls.length) {
        out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      }
      text = '';
      calls = [];
    };

    for (const part of turn.parts) {
      if (part.type === 'tool-result') {
        flush();
        out.push(toToolMessage(part));
      } else if (part.type === 'text') {
        text += part.text;
      } else if (part.type === 'tool-call') {
        calls.push({
          id: part.toolCallId,
          type: 'function',
          function: {
            name: part.toolName,
            arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {}),
          },
        });
      }
    }
    flush();
  }

  return out;
}

function toToolMessage(part: Extract<MessagePart, { type: 'tool-result' }>): MessageParam {
  return {
    role: 'tool',
    tool_call_id: part.toolCallId,
    content: JSON.stringify(part.output ?? { success: false, message: part.error }),
  };
}

type OpenAIFinishReason = OpenAI.Chat.Completions.ChatCompletion.Choice['finish_reason'] | null;

/**
 * Some OpenAI-compatible servers (Ollama among them) end a tool step with
 * `stop` instead of `tool_calls`, so any finished step with calls counts.
 */
function finishReason(reason: OpenAIFinishReason, hasToolCalls: boolean, refused: boolean): FinishReason {
  if (refused) return 'refusal';
  if (reason === 'length') return 'length';
  if (reason === 'content_filter') return 'content-filter';
  if (hasToolCalls) return 'tool-calls';
  return 'stop';
}

function toUsage(usage: OpenAI.CompletionUsage | null | undefined): TokenUsage {
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    ...(cached ? { cacheReadTokens: cached } : {}),
  };
}

function rejectsStreamOptions(error: unknown): boolean {
  const status = (error as { status?: unknown })?.status;
  const message = error instanceof Error ? error.message : '';
  return status === 400 && /stream_options|include_usage/.test(message);
}

export class OpenAIProvider implements AIProvider {
  name: string;
  private client: OpenAI;
  readonly model: string;
  private reasoning: boolean;
  private effort: ProviderEffort;
  private maxTokensParam: 'max_completion_tokens' | 'max_tokens';
  private supportsTools: boolean;
  /** Set once a server rejects `stream_options`; usage isn't asked for after that. */
  private streamUsage = true;

  constructor(config: ProviderConfig, options: { compatible?: boolean } = {}) {
    this.name = options.compatible ? 'openai-compatible' : 'openai';
    if (options.compatible) {
      if (!config.baseURL?.trim()) throw new Error('openai-compatible requires baseURL');
      if (!config.model?.trim()) throw new Error('openai-compatible requires model');
    } else if (!config.apiKey?.trim()) {
      throw new Error('openai requires apiKey');
    }
    this.client = new OpenAI({
      apiKey: config.apiKey || 'chatcops-local',
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.headers ? { defaultHeaders: config.headers } : {}),
      ...(config.organization ? { organization: config.organization } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.reasoning = isOpenAIReasoningModel(this.model, config.baseURL);
    this.effort = config.effort ?? DEFAULT_EFFORT;
    this.maxTokensParam = config.maxTokensParam ?? (options.compatible ? 'max_tokens' : 'max_completion_tokens');
    this.supportsTools = config.supportsTools ?? true;
  }

  private request(
    params: Pick<ProviderStepParams, 'tools' | 'maxTokens' | 'temperature'>,
    messages: OpenAI.Chat.ChatCompletionMessageParam[]
  ) {
    if (!this.supportsTools && params.tools?.length) {
      warnOnce(
        `${this.name}-tools-${this.model}`,
        `${this.name} model ${this.model} has supportsTools: false, so configured tools are not sent.`
      );
    }
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
      ...(this.supportsTools && params.tools?.length ? { tools: toOpenAITools(params.tools) } : {}),
      ...(temperature != null ? { temperature } : {}),
      ...(this.reasoning ? { reasoning_effort: this.effort } : {}),
    };
  }

  private async openStream(params: ProviderStepParams) {
    const system = joinSystem(params.systemPrompt, params.systemContext);
    const body = { ...this.request(params, toOpenAIStepMessages(system, params.messages)), stream: true as const };
    if (this.streamUsage) {
      try {
        return await this.client.chat.completions.create(
          { ...body, stream_options: { include_usage: true } },
          { signal: params.signal }
        );
      } catch (error) {
        if (!rejectsStreamOptions(error)) throw error;
        this.streamUsage = false;
        warnOnce(
          `openai-stream-options-${this.model}`,
          "The server doesn't accept `stream_options`, so token usage isn't reported for this provider."
        );
      }
    }
    return this.client.chat.completions.create(body, { signal: params.signal });
  }

  /** One model request: streams text, then reports tool calls, usage and why it stopped. */
  async *step(params: ProviderStepParams): AsyncGenerator<ProviderEvent> {
    params.signal?.throwIfAborted();
    const stream = await this.openStream(params);

    let reason: OpenAIFinishReason = null;
    let usage: OpenAI.CompletionUsage | null | undefined;
    let text = '';
    let refusal = '';
    const calls = new Map<number, { id: string; synthetic: boolean; name: string; arguments: string }>();

    for await (const chunk of stream) {
      // With include_usage, the last chunk carries usage and no choices.
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices[0];
      if (!choice) continue;
      reason = choice.finish_reason ?? reason;

      const delta = choice.delta;
      if (delta?.content) {
        text += delta.content;
        yield { type: 'text-delta', delta: delta.content };
      }
      if (delta?.refusal) refusal += delta.refusal;

      for (const callDelta of delta?.tool_calls ?? []) {
        if (callDelta.type && callDelta.type !== 'function') continue;
        const call = calls.get(callDelta.index) ?? { id: '', synthetic: true, name: '', arguments: '' };
        if (callDelta.id) {
          call.id = callDelta.id;
          call.synthetic = false;
        }
        if (callDelta.function?.name) call.name = callDelta.function.name;
        if (callDelta.function?.arguments) call.arguments += callDelta.function.arguments;
        calls.set(callDelta.index, call);
      }
    }

    // The SDK ends the stream quietly when it's aborted, so check here, or a
    // cancelled reply would look like a finished empty one.
    params.signal?.throwIfAborted();

    const parts: MessagePart[] = [];
    if (text) parts.push({ type: 'text', text });
    if (refusal) parts.push({ type: 'text', text: refusal });

    const ordered = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
    const events: ProviderEvent[] = [];
    for (const call of ordered) {
      const id = call.synthetic ? createToolCallId() : call.id;
      let input: Record<string, unknown> = {};
      let inputError: string | undefined;
      try {
        input = parseToolInput(call.arguments);
      } catch (error) {
        inputError = error instanceof Error ? error.message : 'Tool arguments must be valid JSON.';
      }
      parts.push({
        type: 'tool-call',
        toolCallId: id,
        toolName: call.name,
        // Keep what the model sent when it isn't JSON, so it can see its mistake.
        input: inputError ? call.arguments : input,
        executor: 'server',
        state: inputError ? 'error' : 'pending',
      });
      events.push({ type: 'tool-call', call: { id, name: call.name, input }, ...(inputError ? { inputError } : {}) });
    }

    yield* events;
    yield {
      type: 'finish',
      reason: finishReason(reason, ordered.length > 0, refusal !== ''),
      usage: toUsage(usage),
      parts,
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
