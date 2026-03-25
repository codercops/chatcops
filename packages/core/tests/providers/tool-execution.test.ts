import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeToolCall } from '../../src/providers/tool-execution.js';
import type { ProviderChatParams, ProviderToolCall, ToolResult } from '../../src/types.js';

function createParams(overrides?: Partial<ProviderChatParams>): ProviderChatParams {
  return {
    messages: [{ id: '1', role: 'user', content: 'Check order 123', timestamp: Date.now() }],
    systemPrompt: 'You are helpful.',
    ...overrides,
  };
}

const toolCall: ProviderToolCall = {
  id: 'call_1',
  name: 'lookup_order',
  input: { orderId: '123' },
};

function createHangingToolExecutor(): NonNullable<ProviderChatParams['toolExecutor']> {
  return vi.fn().mockImplementation(
    () => new Promise<ToolResult>(() => undefined)
  ) as NonNullable<ProviderChatParams['toolExecutor']>;
}

describe('executeToolCall', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a failure result when tool execution exceeds the timeout', async () => {
    vi.useFakeTimers();

    const resultPromise = executeToolCall(
      createParams({
        toolTimeoutMs: 50,
        toolExecutor: createHangingToolExecutor(),
      }),
      toolCall
    );

    await vi.advanceTimersByTimeAsync(50);

    await expect(resultPromise).resolves.toEqual({
      success: false,
      message: 'Tool execution timed out after 50ms.',
    });
  });

  it('returns the tool result when execution completes before the timeout', async () => {
    vi.useFakeTimers();

    const expectedResult: ToolResult = {
      success: true,
      data: { status: 'shipped' },
      message: 'Order found',
    };

    const result = await executeToolCall(
      createParams({
        toolTimeoutMs: 50,
        toolExecutor: vi.fn().mockResolvedValue(expectedResult),
      }),
      toolCall
    );

    expect(result).toEqual(expectedResult);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the configured timeout value', async () => {
    vi.useFakeTimers();

    const resultPromise = executeToolCall(
      createParams({
        toolTimeoutMs: 10,
        toolExecutor: createHangingToolExecutor(),
      }),
      toolCall
    );

    await vi.advanceTimersByTimeAsync(9);
    await expect(Promise.race([resultPromise, Promise.resolve('pending')])).resolves.toBe('pending');

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual({
      success: false,
      message: 'Tool execution timed out after 10ms.',
    });
  });
});
