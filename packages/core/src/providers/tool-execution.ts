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

export async function executeToolCall(
  params: ProviderChatParams,
  call: ProviderToolCall
): Promise<ToolResult> {
  if (!params.toolExecutor) {
    return {
      success: false,
      message: `No tool executor is configured for "${call.name}".`,
    };
  }

  const timeoutMs = params.toolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
  const timers = globalThis as typeof globalThis & {
    setTimeout: (callback: () => void, delay?: number) => unknown;
    clearTimeout: (timeoutId: unknown) => void;
  };
  let timeoutId: unknown;

  try {
    return await Promise.race([
      params.toolExecutor(call),
      new Promise<never>((_, reject) => {
        timeoutId = timers.setTimeout(() => {
          reject(new Error(`Tool execution timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    return toToolFailure(error);
  } finally {
    if (timeoutId !== undefined) {
      timers.clearTimeout(timeoutId);
    }
  }
}
