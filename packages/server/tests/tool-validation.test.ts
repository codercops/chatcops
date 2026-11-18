import { describe, expect, it, vi } from 'vitest';

vi.mock('@chatcops/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatcops/core')>();
  return {
    ...actual,
    createProvider: vi.fn(async () => ({ name: 'fake', async *chat() {}})),
  };
});

import type { ChatTool } from '@chatcops/core';
import { createChatHandler } from '../src/handler.js';

const tool = (overrides: Partial<ChatTool>): ChatTool => ({
  name: 'lookup',
  description: 'Look something up',
  inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
  execute: async () => ({ success: true }),
  ...overrides,
});

describe('tool definitions at startup', () => {
  it('fails right away with every problem listed', () => {
    expect(() =>
      createChatHandler({ allowAnonymous: true, provider: { type: 'claude', apiKey: 'test' }, systemPrompt: 'x', tools: [tool({ name: 'bad name' }), tool({}), tool({})] })
    ).toThrow(/Invalid tool definitions:[\s\S]*"bad name"[\s\S]*"lookup": another tool has the same name/);
  });

  it('accepts JSON Schema tools', () => {
    const handler = createChatHandler({ allowAnonymous: true, provider: { type: 'claude', apiKey: 'test' }, systemPrompt: 'x', tools: [tool({})] });
    handler.cleanup();
  });
});
