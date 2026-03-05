import { describe, it, expect } from 'vitest';
import { toOpenAITools } from '../../src/providers/base.js';
import type { ToolDefinition } from '../../src/types.js';

describe('OpenAI provider helpers', () => {
  it('converts tools to OpenAI function format', () => {
    const tools: ToolDefinition[] = [{
      name: 'search',
      description: 'Search the web',
      parameters: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    }];

    const result = toOpenAITools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('search');
    expect(result[0].function.parameters.type).toBe('object');
    expect(result[0].function.parameters.properties).toHaveProperty('query');
  });
});
