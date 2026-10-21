import { describe, expect, it } from 'vitest';
import { executorRegistry, MAX_TOOL_OUTPUT_CHARS, toolOutput, toolRegistry } from '../../src/agent/tool-registry.js';

const context = { conversationId: 'c1', signal: new AbortController().signal };

describe('tool registries', () => {
  it('answers a call to a tool that does not exist', async () => {
    await expect(toolRegistry([]).run({ id: '1', name: 'nope', input: {} }, context)).resolves.toEqual({
      success: false,
      message: 'Unknown tool: nope',
    });
  });

  it('answers a call when no executor is configured', async () => {
    await expect(executorRegistry([]).run({ id: '1', name: 'lookup', input: {} }, context)).resolves.toEqual({
      success: false,
      message: 'No tool executor is configured for "lookup".',
    });
  });
});

describe('toolOutput', () => {
  it('stores what the model saw, as plain JSON', () => {
    expect(toolOutput({ success: true, data: { when: new Date(0) } })).toEqual({ success: true, data: { when: '1970-01-01T00:00:00.000Z' } });
  });

  it('cuts off output that is too big to store', () => {
    const output = toolOutput({ success: true, data: 'x'.repeat(MAX_TOOL_OUTPUT_CHARS * 2) }) as { data: string };
    expect(output.data.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 200);
    expect(output.data).toMatch(/cut off/);
  });

  it("replaces output that can't be turned into JSON", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toolOutput({ success: true, data: circular })).toEqual({ success: false, message: "The tool returned something that isn't JSON." });
  });
});
