import Anthropic from '@anthropic-ai/sdk';
import type { ProviderConfig, ProviderChatParams, ProviderEffort } from '../types.js';
import type { AIProvider } from './base.js';
import { DEFAULT_MAX_TOKENS, normalizeHistory, toClaudeTools, warnOnce } from './base.js';
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
  private model: string;
  private effort: ProviderEffort | undefined;

  constructor(config: ProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    });
    this.model = config.model ?? DEFAULT_MODEL;

    if (claudeSupportsEffort(this.model)) {
      this.effort = config.effort ?? DEFAULT_EFFORT;
    } else if (config.effort) {
      warnOnce(`claude-effort-${this.model}`, `${this.model} has no effort setting, so \`effort\` is ignored.`);
    }
  }

  private request(params: ProviderChatParams, messages: Anthropic.Messages.MessageParam[]) {
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
