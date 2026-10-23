import Anthropic from '@anthropic-ai/sdk';
import type {
  ChatMessage,
  MessagePart,
  ProviderChatParams,
  ProviderConfig,
  ProviderEffort,
  TokenUsage,
  ToolCallPart,
} from '../types.js';
import type { AIProvider } from './base.js';
import { chatSyncViaTurn, chatViaTurn } from '../agent/chat.js';
import { joinSystem } from '../agent/run-turn.js';
import { DEFAULT_MAX_TOKENS, toClaudeTools, warnOnce } from './base.js';
import { normalizeTurns, type TurnPart } from './history.js';
import type { FinishReason, ProviderEvent, ProviderStepParams } from './types.js';

const DEFAULT_MODEL = 'claude-haiku-5-5';
const DEFAULT_EFFORT: ProviderEffort = 'low';

interface ClaudeVersion {
  family: string;
  major: number;
  minor: number;
}

/** Reads family and version from ids like `claude-haiku-5-5` or `claude-haiku-4-5-20251001`. */
export function parseClaudeModel(model: string): ClaudeVersion | null {
  const match = model.match(/claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?/);
  if (!match) return null;
  return { family: match[1], major: Number(match[2]), minor: Number(match[3] ?? 0) };
}

/** `output_config.effort` exists on Opus 4.5 and on every model from 4.6 on. */
export function claudeSupportsEffort(model: string): boolean {
  const version = parseClaudeModel(model);
  if (!version) return false;
  if (version.family === 'fable' || version.family === 'mythos') return true;
  if (version.major >= 5) return true;
  if (version.major === 4 && version.minor >= 6) return true;
  return version.family === 'opus' && version.major === 4 && version.minor === 5;
}

/** Fable, Mythos, every 5.x model and Opus 4.7+ reject non-default `temperature`. */
export function claudeRejectsTemperature(model: string): boolean {
  const version = parseClaudeModel(model);
  if (!version) return false;
  if (version.family === 'fable' || version.family === 'mythos') return true;
  if (version.major >= 5) return true;
  return version.family === 'opus' && version.major === 4 && version.minor >= 7;
}

type MessageParam = Anthropic.Messages.MessageParam;
type ContentBlockParam = Anthropic.Messages.ContentBlockParam;

/** What a stored part needs to go back to Claude: thinking signatures. */
interface ClaudePartMetadata {
  signature?: string;
  redactedData?: string;
}

function claudeMetadata(part: TurnPart): ClaudePartMetadata | undefined {
  return 'providerMetadata' in part ? (part.providerMetadata?.claude as ClaudePartMetadata | undefined) : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toClaudeBlock(part: TurnPart): ContentBlockParam | null {
  switch (part.type) {
    case 'text':
      return part.text ? { type: 'text', text: part.text } : null;
    case 'reasoning': {
      // Reasoning from another provider has no Claude signature, and Claude
      // rejects thinking blocks without one, so it isn't sent.
      const meta = claudeMetadata(part);
      if (meta?.signature) return { type: 'thinking', thinking: part.text, signature: meta.signature };
      if (meta?.redactedData) return { type: 'redacted_thinking', data: meta.redactedData };
      return null;
    }
    case 'tool-call':
      return {
        type: 'tool_use',
        id: part.toolCallId,
        name: part.toolName,
        input: isPlainObject(part.input) ? part.input : {},
      };
    case 'tool-result':
      return {
        type: 'tool_result',
        tool_use_id: part.toolCallId,
        content: JSON.stringify(part.output ?? { success: false, message: part.error }),
        is_error: part.error !== undefined,
      };
  }
}

const isToolResultBlock = (block: ContentBlockParam) => block.type === 'tool_result';

/**
 * Stored history as Claude messages. An assistant message with tool calls
 * becomes the assistant turn with its `tool_use` blocks, then a user turn
 * with the results, and so on for each step. Thinking blocks go back with
 * their signatures, as Claude requires within a tool loop.
 */
export function toClaudeStepMessages(messages: ChatMessage[]): MessageParam[] {
  const out: { role: MessageParam['role']; content: ContentBlockParam[] }[] = [];

  const push = (role: MessageParam['role'], blocks: ContentBlockParam[]) => {
    if (blocks.length === 0) return;
    const last = out.at(-1);
    if (!last || last.role !== role) {
      out.push({ role, content: blocks });
      return;
    }
    // Two user turns in a row (tool results, then the visitor's next
    // message): Claude wants the tool results first.
    const merged = [...last.content, ...blocks];
    last.content = role === 'user'
      ? [...merged.filter(isToolResultBlock), ...merged.filter((block) => !isToolResultBlock(block))]
      : merged;
  };

  for (const turn of normalizeTurns(messages)) {
    let role: MessageParam['role'] = turn.role;
    let run: ContentBlockParam[] = [];
    for (const part of turn.parts) {
      const block = toClaudeBlock(part);
      if (!block) continue;
      const blockRole = part.type === 'tool-result' ? 'user' : turn.role;
      if (blockRole !== role) {
        push(role, run);
        run = [];
        role = blockRole;
      }
      run.push(block);
    }
    push(role, run);
  }

  // Plain text from the visitor goes as a string, as it always has.
  return out.map((message) =>
    message.role === 'user' && message.content.every((block) => block.type === 'text')
      ? { role: 'user', content: message.content.map((block) => (block as Anthropic.Messages.TextBlockParam).text).join('\n\n') }
      : message
  );
}

/** The parts of a Claude reply, in order, with what's needed to send them back. */
function toParts(content: Anthropic.Messages.Message['content']): MessagePart[] {
  const parts: MessagePart[] = [];
  for (const block of content) {
    switch (block.type) {
      case 'thinking':
        parts.push({ type: 'reasoning', text: block.thinking, providerMetadata: { claude: { signature: block.signature } } });
        break;
      case 'redacted_thinking':
        parts.push({ type: 'reasoning', text: '', providerMetadata: { claude: { redactedData: block.data } } });
        break;
      case 'text':
        if (block.text) parts.push({ type: 'text', text: block.text });
        break;
      case 'tool_use':
        parts.push({
          type: 'tool-call',
          toolCallId: block.id,
          toolName: block.name,
          input: block.input,
          executor: 'server',
          state: 'pending',
        });
        break;
      default:
        break;
    }
  }
  return parts;
}

function finishReason(stopReason: Anthropic.Messages.Message['stop_reason'], hasToolCalls: boolean): FinishReason {
  switch (stopReason) {
    case 'tool_use':
      return hasToolCalls ? 'tool-calls' : 'stop';
    case 'max_tokens':
      return 'length';
    case 'refusal':
      return 'refusal';
    default:
      return 'stop';
  }
}

/** Input tokens include cache reads and writes, so budgets count every token sent. */
function toUsage(usage: Anthropic.Messages.Usage | undefined): TokenUsage {
  const cacheRead = usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: (usage?.input_tokens ?? 0) + cacheRead + cacheWrite,
    outputTokens: usage?.output_tokens ?? 0,
    ...(cacheRead ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite ? { cacheWriteTokens: cacheWrite } : {}),
  };
}

export class ClaudeProvider implements AIProvider {
  name = 'claude';
  private client: Anthropic;
  readonly model: string;
  private effort: ProviderEffort | undefined;
  private promptCaching: boolean;

  constructor(config: ProviderConfig) {
    if (!config.apiKey?.trim()) throw new Error('claude requires apiKey');
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    this.model = config.model ?? DEFAULT_MODEL;
    this.promptCaching = config.promptCaching ?? true;

    if (claudeSupportsEffort(this.model)) {
      this.effort = config.effort ?? DEFAULT_EFFORT;
    } else if (config.effort) {
      warnOnce(`claude-effort-${this.model}`, `${this.model} has no effort setting, so \`effort\` is ignored.`);
    }
  }

  /**
   * The system prompt, with a cache breakpoint after it. Claude caches tools
   * and system together, in that order, so both are read from the cache on
   * later requests. Per-request context goes after the breakpoint.
   */
  private system(params: Pick<ProviderStepParams, 'systemPrompt' | 'systemContext'>) {
    if (!this.promptCaching) return joinSystem(params.systemPrompt, params.systemContext);
    return [
      { type: 'text' as const, text: params.systemPrompt, cache_control: { type: 'ephemeral' as const } },
      ...(params.systemContext ? [{ type: 'text' as const, text: params.systemContext }] : []),
    ];
  }

  private request(
    params: Pick<ProviderStepParams, 'systemPrompt' | 'systemContext' | 'tools' | 'maxTokens' | 'temperature'>,
    messages: Anthropic.Messages.MessageParam[]
  ) {
    let temperature = params.temperature;
    if (temperature != null && claudeRejectsTemperature(this.model)) {
      warnOnce(
        `claude-temperature-${this.model}`,
        `${this.model} doesn't accept \`temperature\`, so it is not sent. Use \`effort\` to trade speed for depth.`
      );
      temperature = undefined;
    }

    return {
      model: this.model,
      max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: this.system(params),
      messages,
      ...(params.tools?.length ? { tools: toClaudeTools(params.tools) } : {}),
      ...(temperature != null ? { temperature } : {}),
      ...(this.effort ? { output_config: { effort: this.effort } } : {}),
    } satisfies Anthropic.Messages.MessageCreateParamsNonStreaming;
  }

  /** One model request: streams text and reasoning, then reports tool calls and why it stopped. */
  async *step(params: ProviderStepParams): AsyncGenerator<ProviderEvent> {
    params.signal?.throwIfAborted();
    const stream = this.client.messages.stream(
      this.request(params, toClaudeStepMessages(params.messages)),
      { signal: params.signal }
    );

    for await (const event of stream) {
      if (event.type !== 'content_block_delta') continue;
      if (event.delta.type === 'text_delta') yield { type: 'text-delta', delta: event.delta.text };
      else if (event.delta.type === 'thinking_delta') yield { type: 'reasoning-delta', delta: event.delta.thinking };
    }

    const message = await stream.finalMessage();
    if (message.stop_reason === 'model_context_window_exceeded') {
      throw new Error('The conversation is longer than the model context window.');
    }

    const parts = toParts(message.content);
    const calls = parts.filter((part): part is ToolCallPart => part.type === 'tool-call');
    for (const call of calls) {
      yield {
        type: 'tool-call',
        call: { id: call.toolCallId, name: call.toolName, input: call.input as Record<string, unknown> },
      };
    }

    yield {
      type: 'finish',
      reason: finishReason(message.stop_reason, calls.length > 0),
      usage: toUsage(message.usage),
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
