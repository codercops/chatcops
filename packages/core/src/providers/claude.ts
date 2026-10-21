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
import { DEFAULT_MAX_TOKENS, normalizeHistory, toClaudeTools, warnOnce } from './base.js';
import { normalizeTurns, type TurnPart } from './history.js';
import type { FinishReason, ProviderEvent, ProviderStepParams } from './types.js';
import {
  MAX_TOOL_ROUNDS,
  executeToolCall,
  serializeToolResult,
} from './tool-execution.js';

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

function toClaudeMessages(params: ProviderChatParams): Anthropic.Messages.MessageParam[] {
  return normalizeHistory(params.messages).map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

/**
 * Sends the assistant turn back for the next tool round. Thinking blocks must
 * go back unchanged (including the signature), or the API rejects the request.
 */
function toAssistantContentBlocks(
  content: Anthropic.Messages.Message['content']
): Anthropic.Messages.ContentBlockParam[] {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [];

  for (const block of content) {
    switch (block.type) {
      case 'text':
        blocks.push({ type: 'text', text: block.text });
        break;
      case 'thinking':
        blocks.push({ type: 'thinking', thinking: block.thinking, signature: block.signature });
        break;
      case 'redacted_thinking':
        blocks.push({ type: 'redacted_thinking', data: block.data });
        break;
      case 'tool_use':
        blocks.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
        break;
      default:
        break;
    }
  }

  return blocks;
}

function textOf(content: Anthropic.Messages.Message['content']): string {
  return content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export class ClaudeProvider implements AIProvider {
  name = 'claude';
  private client: Anthropic;
  readonly model: string;
  private effort: ProviderEffort | undefined;

  constructor(config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      ...(config.fetch ? { fetch: config.fetch } : {}),
    });
    this.model = config.model ?? DEFAULT_MODEL;

    if (claudeSupportsEffort(this.model)) {
      this.effort = config.effort ?? DEFAULT_EFFORT;
    } else if (config.effort) {
      warnOnce(`claude-effort-${this.model}`, `${this.model} has no effort setting, so \`effort\` is ignored.`);
    }
  }

  private request(
    params: Pick<ProviderStepParams, 'systemPrompt' | 'tools' | 'maxTokens' | 'temperature'>,
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
      system: params.systemPrompt,
      messages,
      ...(params.tools?.length ? { tools: toClaudeTools(params.tools) } : {}),
      ...(temperature != null ? { temperature } : {}),
      ...(this.effort ? { output_config: { effort: this.effort } } : {}),
    } satisfies Anthropic.Messages.MessageCreateParamsNonStreaming;
  }

  /** Throws on stop reasons that mean the reply can't be used. */
  private checkStopReason(message: Anthropic.Messages.Message): void {
    if (message.stop_reason === 'refusal') {
      throw new Error('Claude declined to answer this request (stop_reason: refusal).');
    }
    if (message.stop_reason === 'model_context_window_exceeded') {
      throw new Error('The conversation is longer than the model context window.');
    }
    if (message.stop_reason === 'max_tokens') {
      console.warn(`[chatcops] Claude reply cut off at max_tokens (${message.usage.output_tokens} tokens). Raise \`maxTokens\` if this keeps happening.`);
    }
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

  async *chat(params: ProviderChatParams): AsyncGenerator<string> {
    const messages = toClaudeMessages(params);
    let toolRounds = 0;

    while (true) {
      params.signal?.throwIfAborted();
      const stream = this.client.messages.stream(this.request(params, messages), { signal: params.signal });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text;
        }
      }

      const message = await stream.finalMessage();
      this.checkStopReason(message);
      const toolUses = message.content.filter((block) => block.type === 'tool_use');

      if (message.stop_reason !== 'tool_use' || toolUses.length === 0) {
        return;
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      messages.push({ role: 'assistant', content: toAssistantContentBlocks(message.content) });
      messages.push({ role: 'user', content: await this.runTools(params, toolUses) });
    }
  }

  async chatSync(params: ProviderChatParams): Promise<string> {
    const messages = toClaudeMessages(params);
    let toolRounds = 0;
    let text = '';

    while (true) {
      params.signal?.throwIfAborted();
      const response = await this.client.messages.create(this.request(params, messages), { signal: params.signal });
      this.checkStopReason(response);
      text += textOf(response.content);

      const toolUses = response.content.filter((block) => block.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        return text;
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        throw new Error(`Exceeded maximum tool rounds (${MAX_TOOL_ROUNDS}).`);
      }
      toolRounds += 1;

      messages.push({ role: 'assistant', content: toAssistantContentBlocks(response.content) });
      messages.push({ role: 'user', content: await this.runTools(params, toolUses) });
    }
  }

  private async runTools(
    params: ProviderChatParams,
    toolUses: Anthropic.Messages.ToolUseBlock[]
  ): Promise<Anthropic.Messages.ToolResultBlockParam[]> {
    return Promise.all(toolUses.map(async (toolUse) => {
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
  }
}
