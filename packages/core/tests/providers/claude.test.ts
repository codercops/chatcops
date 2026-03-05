import { describe, it, expect, vi } from 'vitest';
import { toClaudeTools, toProviderMessages } from '../../src/providers/base.js';
import type { ChatMessage, ToolDefinition } from '../../src/types.js';

describe('Claude provider helpers', () => {
  it('converts messages, filtering out system role', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'system', content: 'You are helpful', timestamp: Date.now() },
      { id: '2', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: '3', role: 'assistant', content: 'Hi!', timestamp: Date.now() },
    ];

    const result = toProviderMessages(messages);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  it('converts tools to Claude format', () => {
    const tools: ToolDefinition[] = [{
      name: 'get_weather',
      description: 'Get the weather',
      parameters: {
        location: { type: 'string', description: 'City name' },
      },
      required: ['location'],
    }];

    const result = toClaudeTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('get_weather');
    expect(result[0].input_schema.type).toBe('object');
    expect(result[0].input_schema.properties).toHaveProperty('location');
    expect(result[0].input_schema.required).toEqual(['location']);
  });
});
