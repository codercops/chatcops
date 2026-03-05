import { describe, it, expect } from 'vitest';
import { SchemaType } from '@google/generative-ai';
import { toGeminiTools } from '../../src/providers/base.js';
import type { ToolDefinition } from '../../src/types.js';

describe('Gemini provider helpers', () => {
  it('converts tools to Gemini functionDeclarations format', () => {
    const tools: ToolDefinition[] = [{
      name: 'get_price',
      description: 'Get product price',
      parameters: {
        productId: { type: 'string', description: 'Product ID' },
        currency: { type: 'string', description: 'Currency', enum: ['USD', 'EUR'] },
      },
      required: ['productId'],
    }];

    const result = toGeminiTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].functionDeclarations).toHaveLength(1);

    const decl = result[0].functionDeclarations![0];
    expect(decl.name).toBe('get_price');
    expect(decl.parameters?.type).toBe(SchemaType.OBJECT);
    expect(decl.parameters?.properties).toHaveProperty('productId');
    expect(decl.parameters?.properties?.currency).toHaveProperty('enum');
  });
});
