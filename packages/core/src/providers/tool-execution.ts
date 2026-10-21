import type { ProviderChatParams, ProviderToolCall, ToolResult } from '../types.js';

export const MAX_TOOL_ROUNDS = 5;
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

export function parseToolInput(rawInput: string): Record<string, unknown> {
  if (!rawInput.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    throw new Error('Tool arguments must be valid JSON.');
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Tool arguments must be a JSON object.');
  }

  return parsed as Record<string, unknown>;
}

export function serializeToolResult(result: ToolResult): Record<string, unknown> {
  return {
    success: result.success,
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.message ? { message: result.message } : {}),
  };
}

export function toToolFailure(error: unknown): ToolResult {
  return {
    success: false,
    message: error instanceof Error ? error.message : 'Tool execution failed.',
  };
}

type Timers = typeof globalThis & {
  setTimeout: (callback: () => void, delay?: number) => unknown;
  clearTimeout: (timeoutId: unknown) => void;
};

/**
 * Runs a tool with a timeout. The tool gets a signal that aborts when the
 * timeout passes or when `signal` aborts (the visitor left), and the result
 * comes back as a failure right away in both cases, so a tool that ignores
 * its signal can't hold up the reply.
 */
export async function runToolWithTimeout(
  run: (signal: AbortSignal) => Promise<ToolResult>,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ToolResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const timers = globalThis as Timers;
  const controller = new AbortController();
  let timeoutId: unknown;
  let onAbort: (() => void) | undefined;

  try {
    return await Promise.race([
      run(controller.signal),
      new Promise<never>((_, reject) => {
        timeoutId = timers.setTimeout(() => {
          const error = new Error(`Tool execution timed out after ${timeoutMs}ms.`);
          controller.abort(error);
          reject(error);
        }, timeoutMs);
        if (options.signal) {
          onAbort = () => {
            controller.abort(options.signal?.reason);
            reject(new Error('The reply was cancelled before the tool finished.'));
          };
          if (options.signal.aborted) onAbort();
          else options.signal.addEventListener('abort', onAbort, { once: true });
        }
      }),
    ]);
  } catch (error) {
    return toToolFailure(error);
  } finally {
    if (timeoutId !== undefined) timers.clearTimeout(timeoutId);
    if (onAbort) options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function executeToolCall(
  params: ProviderChatParams,
  call: ProviderToolCall
): Promise<ToolResult> {
  const executor = params.toolExecutor;
  if (!executor) {
    return {
      success: false,
      message: `No tool executor is configured for "${call.name}".`,
    };
  }
  // The executor gets the call alone, as in 0.4.
  return runToolWithTimeout(() => executor(call), { timeoutMs: params.toolTimeoutMs });
}
