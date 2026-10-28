import { consoleLogger, type Logger } from '../logger.js';
import { messageText } from '../parts.js';
import { PROTOCOL_VERSION, type WireErrorCode, type WireFinishReason, type WirePart } from '../protocol/v1.js';
import type { AIProvider, ProviderEvent } from '../providers/types.js';
import type {
  ChatMessage,
  MessagePart,
  ProviderToolCall,
  ProviderToolExecutor,
  TokenUsage,
  ToolCallPart,
  ToolResult,
  ToolResultPart,
} from '../types.js';
import { BudgetExceededError, type BudgetContext, type BudgetGuard } from '../limits/budget.js';
import { DEFAULT_MAX_TOKENS } from '../providers/base.js';
import { ContentFilterError, MaxStepsError, RefusalError } from './errors.js';
import { executorRegistry, type ToolRegistry, toolOutput } from './tool-registry.js';
import {
  CitationParser,
  NATIVE_SOURCES_INSTRUCTION,
  parseCitations,
  sourcesContext,
  sourcePart,
} from '../retrieval/citations.js';
import type { RetrievedChunk } from '../retrieval/types.js';

/** Model requests per turn: five tool rounds and the answer after them, as in 0.5. */
export const DEFAULT_MAX_STEPS = 6;

export interface RunTurnOptions {
  provider: AIProvider;
  /** The history to send, oldest first, ending with the visitor's message. */
  messages: ChatMessage[];
  systemPrompt: string;
  /** Per-request instructions, sent after the system prompt and outside the cached prefix. */
  systemContext?: string;
  /**
   * Retrieved chunks the reply can cite. Each one the model cites becomes a
   * `source` part, once per page. Providers with native citations get them
   * as content; others get a numbered block in the system context and cite
   * with `[n]`, and numbers that match no source are removed from the text.
   */
  sources?: RetrievedChunk[];
  tools?: ToolRegistry;
  conversationId: string;
  /** The id to save the reply under. A new one by default. */
  messageId?: string;
  /** Model requests in this turn, counting the final answer. Default 6. */
  maxSteps?: number;
  toolTimeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  /** Aborts the turn, for example when the visitor disconnects. */
  signal?: AbortSignal;
  /** Adds token usage to the `finish` part. */
  exposeUsage?: boolean;
  /** Where warnings and tool errors go. Default `consoleLogger()`. */
  logger?: Logger;
  /**
   * Checked before each model request and charged after it. A used-up
   * budget ends the reply with `budget_exceeded`, and the reply length is
   * capped to the tokens left.
   */
  budget?: { guard: BudgetGuard; context: BudgetContext };
  /**
   * Saves the reply. Called after each tool round with `final: false`, and
   * once at the end with `final: true` and the reply's final status.
   */
  onPersist?(message: ChatMessage, info: { final: boolean }): Promise<void> | void;
  /** Called as each tool call, tool result and emitted part (a captured lead) is added. */
  onPart?(part: MessagePart): void;
}

export interface TurnResult {
  /** `complete`, or `incomplete` (an error, the token limit, the step limit), or `aborted`. */
  status: NonNullable<ChatMessage['status']>;
  message: ChatMessage;
  usage: TokenUsage;
  finishReason: WireFinishReason;
  /** What went wrong, for `incomplete` turns that ended in an error. */
  error?: unknown;
}

const NO_TOOLS: ToolRegistry = executorRegistry([]);

/** One system prompt, for providers that take only one. */
export function joinSystem(systemPrompt: string, systemContext?: string): string {
  return systemContext ? `${systemPrompt}\n\n${systemContext}` : systemPrompt;
}

type ErrorPart = { code: WireErrorCode; retryable: boolean; message?: string; scope?: 'conversation' | 'session' | 'ip' | 'global' };

/** Never ask for fewer output tokens than this, even with little budget left. */
const MIN_STEP_TOKENS = 256;

function addUsage(total: TokenUsage, step: TokenUsage): void {
  total.inputTokens += step.inputTokens;
  total.outputTokens += step.outputTokens;
  if (step.cacheReadTokens) total.cacheReadTokens = (total.cacheReadTokens ?? 0) + step.cacheReadTokens;
  if (step.cacheWriteTokens) total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + step.cacheWriteTokens;
}

/**
 * Signatures only matter within the turn that produced them. Dropping them
 * once the turn is over keeps stored conversations small, and providers
 * accept history without them.
 */
function withoutReplayData(parts: MessagePart[]): MessagePart[] {
  const out: MessagePart[] = [];
  for (const part of parts) {
    if (!('providerMetadata' in part) || !part.providerMetadata) {
      out.push(part);
      continue;
    }
    const { claude: _claude, gemini, ...others } = part.providerMetadata;
    const keptGemini = gemini?.syntheticId ? { gemini: { syntheticId: true } } : {};
    const providerMetadata = { ...others, ...keptGemini };
    const { providerMetadata: _, ...rest } = part;
    if (part.type === 'reasoning' && part.text === '') continue;
    if (part.type === 'text' && part.text === '') continue;
    out.push(Object.keys(providerMetadata).length ? ({ ...rest, providerMetadata } as MessagePart) : (rest as MessagePart));
  }
  return out;
}

function resultPart(call: ProviderToolCall, result: ToolResult): ToolResultPart {
  return {
    type: 'tool-result',
    toolCallId: call.id,
    toolName: call.name,
    output: toolOutput(result),
    ...(result.success ? {} : { error: result.message ?? 'The tool failed.' }),
  };
}

function toWire(part: MessagePart): WirePart | null {
  switch (part.type) {
    case 'tool-call':
      return { type: 'tool-call', toolCallId: part.toolCallId, toolName: part.toolName, input: part.input, executor: part.executor };
    case 'tool-result':
      return { type: 'tool-result', toolCallId: part.toolCallId, output: part.output, ...(part.error ? { error: part.error } : {}) };
    case 'lead-captured':
      return { type: 'lead-captured', lead: part.lead };
    case 'source':
      return { type: 'source', sourceId: part.sourceId, url: part.url, ...(part.title ? { title: part.title } : {}), ...(part.snippet ? { snippet: part.snippet } : {}) };
    default:
      return null;
  }
}

/**
 * Runs one reply: model steps, tool calls between them, and saving the reply
 * as it grows. Yields protocol v1 parts, starting with `start` and always
 * ending with `finish`, and returns what happened.
 *
 * Provider errors don't throw: they become an `error` part, a `finish` with
 * reason `error`, and `result.error`. An abort ends with reason `aborted`.
 * Only a failing `onPersist` throws.
 */
export async function* runTurn(options: RunTurnOptions): AsyncGenerator<WirePart, TurnResult> {
  const logger = options.logger ?? consoleLogger();
  const { provider, signal } = options;
  const tools = options.tools ?? NO_TOOLS;
  const maxSteps = Math.max(1, options.maxSteps ?? DEFAULT_MAX_STEPS);
  const toolSignal = signal ?? new AbortController().signal;
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const message: ChatMessage = {
    id: options.messageId ?? crypto.randomUUID(),
    role: 'assistant',
    content: '',
    parts: [],
    timestamp: Date.now(),
    aiGenerated: true,
  };
  const parts = message.parts as MessagePart[];
  let textCount = 0;
  const sources = options.sources ?? [];
  const nativeCitations = sources.length > 0 && provider.citations === 'native' && !!provider.step;
  const systemContext = [
    options.systemContext,
    sources.length ? (nativeCitations ? NATIVE_SOURCES_INSTRUCTION : sourcesContext(sources)) : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');
  const citedPages = new Set<string>();

  /** `source` parts for newly cited chunks, at most one per page. */
  function* cite(indexes: number[]): Generator<WirePart> {
    for (const index of indexes) {
      const chunk = sources[index];
      if (!chunk || citedPages.has(chunk.source.id)) continue;
      citedPages.add(chunk.source.id);
      const wire = add(sourcePart(chunk));
      if (wire) yield wire;
    }
  }

  const add = (part: MessagePart): WirePart | null => {
    parts.push(part);
    if (part.type !== 'text' && part.type !== 'reasoning') options.onPart?.(part);
    return toWire(part);
  };

  const persist = async (final: boolean) => {
    message.content = messageText(parts);
    message.usage = { ...usage };
    if (!final) message.status = 'incomplete';
    await options.onPersist?.(message, { final });
  };

  async function* end(
    status: TurnResult['status'],
    detail: { error?: unknown; errorPart?: ErrorPart; reason?: WireFinishReason } = {}
  ): AsyncGenerator<WirePart, TurnResult> {
    message.status = status;
    message.parts = withoutReplayData(parts);
    if (detail.errorPart) yield { type: 'error', ...detail.errorPart };
    const reason: WireFinishReason =
      status === 'aborted' ? 'aborted' : detail.errorPart ? 'error' : (detail.reason ?? 'stop');
    message.content = messageText(message.parts);
    message.usage = { ...usage };
    await options.onPersist?.(message, { final: true });
    yield {
      type: 'finish',
      reason,
      ...(options.exposeUsage ? { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens } } : {}),
    };
    return { status, message, usage, finishReason: reason, ...(detail.error !== undefined ? { error: detail.error } : {}) };
  }

  const failed = (error: unknown) =>
    signal?.aborted
      ? end('aborted')
      : end('incomplete', {
          error,
          errorPart: { code: 'provider_error', retryable: true },
        });

  /**
   * Checks the budget before a model request. Ends the turn when one is used
   * up; otherwise resolves the reply length, capped to the tokens left.
   */
  async function* checkBudget(
    stepNumber: number
  ): AsyncGenerator<WirePart, { ended?: TurnResult; maxTokens?: number }> {
    if (!options.budget) return { maxTokens: options.maxTokens };
    try {
      const { tokensLeft } = await options.budget.guard.before(options.budget.context, stepNumber);
      if (tokensLeft === undefined) return { maxTokens: options.maxTokens };
      const wanted = options.maxTokens ?? DEFAULT_MAX_TOKENS;
      return { maxTokens: Math.min(wanted, Math.max(MIN_STEP_TOKENS, tokensLeft)) };
    } catch (error) {
      if (!(error instanceof BudgetExceededError)) throw error;
      return {
        ended: yield* end('incomplete', {
          error,
          errorPart: { code: 'budget_exceeded', retryable: false, scope: error.scope },
        }),
      };
    }
  }

  yield { type: 'start', protocol: PROTOCOL_VERSION, conversationId: options.conversationId, messageId: message.id };

  if (!provider.step) {
    const chat = provider.chat?.bind(provider);
    if (!chat) return yield* failed(new Error(`The provider "${provider.name}" has neither step() nor chat().`));
    return yield* legacyTurn(chat);
  }
  const step = provider.step.bind(provider);

  for (let stepNumber = 1; ; stepNumber++) {
    let textId: string | null = null;
    let finish: Extract<ProviderEvent, { type: 'finish' }> | undefined;
    const calls: Extract<ProviderEvent, { type: 'tool-call' }>[] = [];
    const parser = sources.length && !nativeCitations ? new CitationParser(sources.length) : null;
    const cited: number[] = [];

    const budget = yield* checkBudget(stepNumber);
    if (budget.ended) return budget.ended;

    try {
      signal?.throwIfAborted();
      for await (const event of step({
        messages: [...options.messages, message],
        systemPrompt: options.systemPrompt,
        ...(systemContext ? { systemContext } : {}),
        ...(tools.definitions.length ? { tools: tools.definitions } : {}),
        ...(nativeCitations ? { sources } : {}),
        maxTokens: budget.maxTokens,
        temperature: options.temperature,
        signal,
      })) {
        if (event.type === 'text-delta') {
          if (!event.delta) continue;
          if (!textId) {
            textId = `${message.id}-${++textCount}`;
            yield { type: 'text-start', id: textId };
          }
          const read = parser ? parser.push(event.delta) : { text: event.delta, cited: [] };
          cited.push(...read.cited);
          if (read.text) yield { type: 'text-delta', id: textId, delta: read.text };
        } else if (event.type === 'source') {
          cited.push(event.index);
        } else if (event.type === 'tool-call') {
          calls.push(event);
        } else if (event.type === 'finish') {
          finish = event;
        }
        // Reasoning is kept in the stored parts but never streamed (F01-D5).
      }
      if (!finish) throw new Error(`The ${provider.name} step ended without finishing.`);
    } catch (error) {
      if (textId) yield { type: 'text-end', id: textId };
      return yield* failed(error);
    }
    if (parser && textId) {
      const rest = parser.flush();
      cited.push(...rest.cited);
      if (rest.text) yield { type: 'text-delta', id: textId, delta: rest.text };
    }
    if (textId) yield { type: 'text-end', id: textId };
    addUsage(usage, finish.usage);
    await options.budget?.guard.after(options.budget.context, finish.usage);

    // A refused or filtered step isn't kept: there's nothing in it to send back.
    if (finish.reason === 'refusal' || finish.reason === 'content-filter') {
      return yield* end('incomplete', {
        error: finish.reason === 'refusal' ? new RefusalError() : new ContentFilterError(),
        errorPart: { code: 'content_filtered', retryable: false },
      });
    }

    for (const part of finish.parts) {
      // Stored text gets the same cleanup as the streamed text.
      const stored = parser && part.type === 'text' ? { ...part, text: parseCitations(part.text, sources.length).text } : part;
      const wire = add(stored);
      if (wire) yield wire;
    }
    yield* cite(cited);

    if (finish.reason === 'error') {
      return yield* end('incomplete', {
        error: new Error(`The ${provider.name} step stopped with an error.`),
        errorPart: { code: 'provider_error', retryable: true },
      });
    }
    if (finish.reason === 'length') {
      logger.warn('reply_truncated', 'The reply was cut off at the token limit. Raise `maxTokens` if this keeps happening.');
      return yield* end('incomplete', { reason: 'length' });
    }
    if (finish.reason !== 'tool-calls' || calls.length === 0) {
      return yield* end('complete');
    }

    const callParts = new Map(
      parts.filter((part): part is ToolCallPart => part.type === 'tool-call').map((part) => [part.toolCallId, part])
    );

    if (stepNumber >= maxSteps) {
      for (const { call } of calls) {
        const wire = add(resultPart(call, { success: false, message: 'Not run: the reply reached its tool round limit.' }));
        if (wire) yield wire;
      }
      return yield* end('incomplete', {
        error: new MaxStepsError(maxSteps - 1),
        errorPart: { code: 'tool_error', retryable: false },
      });
    }

    // Every call of the step runs at once; results are kept in call order.
    const results = await Promise.all(
      calls.map(({ call, inputError }) =>
        inputError
          ? Promise.resolve<ToolResult>({ success: false, message: inputError })
          : tools.run(call, { conversationId: options.conversationId, signal: toolSignal, timeoutMs: options.toolTimeoutMs, logger })
      )
    );

    for (const [i, { call }] of calls.entries()) {
      const result = results[i];
      const callPart = callParts.get(call.id);
      if (callPart) callPart.state = result.success ? 'done' : 'error';
      for (const part of [resultPart(call, result), ...(result.success ? tools.emits(call, result) : [])]) {
        const wire = add(part);
        if (wire) yield wire;
      }
    }

    if (signal?.aborted) return yield* end('aborted');
    await persist(false);
  }

  /**
   * A provider written for 0.4 has `chat()` and runs tools itself. Its tool
   * calls are recorded through the executor it's given, and their parts are
   * streamed before the next text, the way the 0.5 server sent them.
   */
  async function* legacyTurn(chat: NonNullable<AIProvider['chat']>): AsyncGenerator<WirePart, TurnResult> {
    // A 0.4 provider reports no usage, so its replies can only be checked, not charged.
    const budget = yield* checkBudget(1);
    if (budget.ended) return budget.ended;
    const queued: WirePart[] = [];
    let textId: string | null = null;
    let text: { type: 'text'; text: string } | null = null;
    const parser = sources.length ? new CitationParser(sources.length) : null;
    const cited: number[] = [];

    const toolExecutor: ProviderToolExecutor = async (call) => {
      text = null;
      const callPart: ToolCallPart = {
        type: 'tool-call', toolCallId: call.id, toolName: call.name, input: call.input, executor: 'server', state: 'pending',
      };
      const callWire = add(callPart);
      if (callWire) queued.push(callWire);
      const result = await tools.run(call, { conversationId: options.conversationId, signal: toolSignal, timeoutMs: options.toolTimeoutMs, logger });
      callPart.state = result.success ? 'done' : 'error';
      for (const part of [resultPart(call, result), ...(result.success ? tools.emits(call, result) : [])]) {
        const wire = add(part);
        if (wire) queued.push(wire);
      }
      return result;
    };

    try {
      for await (const chunk of chat({
        // Providers written for 0.4 read `content` only, so a reply the
        // visitor walked away from would look finished. Leave it out.
        messages: options.messages.filter((m) => m.status !== 'aborted'),
        systemPrompt: joinSystem(options.systemPrompt, systemContext || undefined),
        ...(tools.definitions.length ? { tools: tools.definitions } : {}),
        toolExecutor,
        toolTimeoutMs: options.toolTimeoutMs,
        maxTokens: budget.maxTokens,
        temperature: options.temperature,
        signal,
      })) {
        if (signal?.aborted) break;
        if (!chunk) continue;
        if (queued.length) {
          if (textId) {
            yield { type: 'text-end', id: textId };
            textId = null;
          }
          yield* queued.splice(0);
        }
        if (!textId) {
          textId = `${message.id}-${++textCount}`;
          yield { type: 'text-start', id: textId };
        }
        if (!text) {
          text = { type: 'text', text: '' };
          parts.push(text);
        }
        const read = parser ? parser.push(chunk) : { text: chunk, cited: [] };
        cited.push(...read.cited);
        text.text += read.text;
        if (read.text) yield { type: 'text-delta', id: textId, delta: read.text };
      }
      if (parser && textId) {
        const rest = parser.flush();
        cited.push(...rest.cited);
        if (text) text.text += rest.text;
        if (rest.text) yield { type: 'text-delta', id: textId, delta: rest.text };
      }
    } catch (error) {
      if (textId) yield { type: 'text-end', id: textId };
      // Tool parts recorded so far are saved but not streamed, as in 0.5.
      return yield* failed(error);
    }

    if (textId) yield { type: 'text-end', id: textId };
    if (signal?.aborted) return yield* end('aborted');
    yield* queued.splice(0);
    yield* cite(cited);
    return yield* end('complete');
  }
}
