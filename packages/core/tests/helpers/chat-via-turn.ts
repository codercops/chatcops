import { MAX_TOOL_ROUNDS } from '../../src/providers/tool-execution.js';
import type { AIProvider } from '../../src/providers/types.js';
import type { ProviderChatParams } from '../../src/types.js';
import { runTurn } from '../../src/agent/run-turn.js';
import { executorRegistry } from '../../src/agent/tool-registry.js';

type SteppingProvider = AIProvider & Required<Pick<AIProvider, 'step'>>;

/**
 * `chat()` for providers that have `step()`: runs a turn and yields its text.
 * Errors throw, as they did before turns existed: a refusal, the tool round
 * limit, a provider error, and an abort.
 */
export async function* chatViaTurn(provider: SteppingProvider, params: ProviderChatParams): AsyncGenerator<string> {
  const turn = runTurn({
    provider,
    messages: params.messages,
    systemPrompt: params.systemPrompt,
    tools: executorRegistry(params.tools, params.toolExecutor),
    conversationId: '',
    maxSteps: MAX_TOOL_ROUNDS + 1,
    toolTimeoutMs: params.toolTimeoutMs,
    maxTokens: params.maxTokens,
    temperature: params.temperature,
    signal: params.signal,
  });

  let next = await turn.next();
  while (!next.done) {
    if (next.value.type === 'text-delta') yield next.value.delta;
    next = await turn.next();
  }

  const result = next.value;
  if (result.status === 'aborted') {
    throw params.signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError');
  }
  if (result.error !== undefined) throw result.error;
}

/** `chatSync()` on top of `chat()`: the whole reply as one string. */
export async function chatSyncViaTurn(provider: SteppingProvider, params: ProviderChatParams): Promise<string> {
  let text = '';
  for await (const chunk of chatViaTurn(provider, params)) text += chunk;
  return text;
}
