import type { AIProvider, ProviderEvent, ProviderStepParams } from '../providers/types.js';
import type { MessagePart, TokenUsage } from '../types.js';

/**
 * One scripted model step: the events to yield, a function that builds them
 * from the request, an `Error` to throw, or `'hang'` to wait until the
 * request is aborted (for testing disconnects).
 */
export type ScriptedStep = ProviderEvent[] | ((params: ProviderStepParams) => ProviderEvent[]) | Error | 'hang';

export interface ScriptedProviderOptions {
  name?: string;
  /** Wait this long before each event, to test streaming and timeouts. */
  delayMs?: number;
  /** Act like a provider with native citations: steps get `sources`, and can yield `source` events. */
  citations?: 'native';
}

export interface ScriptedProvider extends AIProvider {
  step(params: ProviderStepParams): AsyncGenerator<ProviderEvent>;
  /** The params of every step so far, in order, with the messages as they were then. */
  readonly calls: ProviderStepParams[];
}

const USAGE: TokenUsage = { inputTokens: 10, outputTokens: 5 };

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortError(signal));
    }, { once: true });
  });
}

/** A step that answers with `text`, streamed in pieces of `chunkSize` characters. */
export function textStep(text: string, options: { chunkSize?: number; usage?: TokenUsage } = {}): ProviderEvent[] {
  const size = options.chunkSize ?? 8;
  const deltas: ProviderEvent[] = [];
  for (let i = 0; i < text.length; i += size) deltas.push({ type: 'text-delta', delta: text.slice(i, i + size) });
  return [...deltas, { type: 'finish', reason: 'stop', usage: options.usage ?? USAGE, parts: text ? [{ type: 'text', text }] : [] }];
}

/** A step that calls tools, optionally after some text. */
export function toolStep(
  calls: Array<{ id?: string; name: string; input?: Record<string, unknown> }>,
  options: { text?: string; usage?: TokenUsage } = {}
): ProviderEvent[] {
  const parts: MessagePart[] = options.text ? [{ type: 'text', text: options.text }] : [];
  const events: ProviderEvent[] = options.text ? [{ type: 'text-delta', delta: options.text }] : [];
  for (const [i, call] of calls.entries()) {
    const id = call.id ?? `call_${i + 1}`;
    const input = call.input ?? {};
    parts.push({ type: 'tool-call', toolCallId: id, toolName: call.name, input, executor: 'server', state: 'pending' });
    events.push({ type: 'tool-call', call: { id, name: call.name, input } });
  }
  return [...events, { type: 'finish', reason: 'tool-calls', usage: options.usage ?? USAGE, parts }];
}

/**
 * A provider that plays back a script instead of calling a model, for tests
 * of anything built on ChatCops: each `step()` call takes the next entry.
 *
 * ```ts
 * const provider = scriptedProvider([
 *   toolStep([{ name: 'lookup_order', input: { id: 'A-1' } }]),
 *   textStep('Your order shipped on Monday.'),
 * ]);
 * ```
 */
export function scriptedProvider(script: ScriptedStep[], options: ScriptedProviderOptions = {}): ScriptedProvider {
  const calls: ProviderStepParams[] = [];

  const provider: ScriptedProvider = {
    name: options.name ?? 'scripted',
    model: 'scripted',
    ...(options.citations ? { citations: options.citations } : {}),
    calls,
    async *step(params) {
      const entry = script[calls.length];
      // A copy, since the reply in `messages` keeps growing after this step.
      calls.push({ ...params, messages: structuredClone(params.messages) });
      if (entry === undefined) throw new Error(`scriptedProvider has no step ${calls.length}.`);
      if (entry instanceof Error) throw entry;
      if (entry === 'hang') {
        await wait(2 ** 31 - 1, params.signal);
        return;
      }
      for (const event of typeof entry === 'function' ? entry(params) : entry) {
        if (options.delayMs) await wait(options.delayMs, params.signal);
        params.signal?.throwIfAborted();
        yield event;
      }
    },
  };
  return provider;
}
