import { describe, expect, it } from 'vitest';
import { toClaudeTools, toGeminiTools, toOpenAITools } from '../../src/providers/base.js';
import {
  ToolDefinitionError,
  legacyParametersToSchema,
  toolInputSchema,
  validateTools,
} from '../../src/providers/schema.js';
import { LeadCaptureTool } from '../../src/tools/lead-capture.js';
import { toolToDefinition } from '../../src/tools/base.js';
import type { ToolDefinition } from '../../src/types.js';

const orderSchema = {
  type: 'object',
  properties: {
    customer: {
      type: 'object',
      properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } },
      required: ['email'],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { sku: { type: 'string' }, qty: { type: 'integer', minimum: 1 } },
        required: ['sku', 'qty'],
      },
      minItems: 1,
    },
    delivery: { anyOf: [{ type: 'string', enum: ['pickup'] }, { type: 'object', properties: { address: { type: 'string' } } }] },
  },
  required: ['customer', 'items'],
};

const orderTool: ToolDefinition = { name: 'place_order', description: 'Place an order', inputSchema: orderSchema };

describe('legacyParametersToSchema', () => {
  it('turns the 0.4 flat form into an object schema', () => {
    expect(
      legacyParametersToSchema(
        { city: { type: 'string', description: 'City' }, unit: { type: 'string', description: 'Unit', enum: ['c', 'f'] } },
        ['city']
      )
    ).toEqual({
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City' },
        unit: { type: 'string', description: 'Unit', enum: ['c', 'f'] },
      },
      required: ['city'],
    });
  });

  it('gives the built-in lead tool the same schema it sent before', () => {
    const schema = toolInputSchema(toolToDefinition(new LeadCaptureTool()));
    expect(schema.required).toEqual(['name', 'email', 'projectDetails']);
    expect(Object.keys(schema.properties as object)).toEqual(['name', 'email', 'company', 'phone', 'projectDetails']);
  });
});

describe('toolInputSchema', () => {
  it('prefers inputSchema and returns it unchanged', () => {
    expect(toolInputSchema(orderTool)).toBe(orderSchema);
  });

  it('treats a tool with neither form as taking no input', () => {
    expect(toolInputSchema({ name: 'ping', description: 'Ping' })).toEqual({ type: 'object', properties: {}, required: [] });
  });
});

describe('provider tool mapping', () => {
  it('sends a nested schema unchanged to Claude, OpenAI and Gemini', () => {
    expect(toClaudeTools([orderTool])[0].input_schema).toEqual(orderSchema);
    expect(toOpenAITools([orderTool])[0].function.parameters).toEqual(orderSchema);
    expect(toGeminiTools([orderTool])[0].functionDeclarations?.[0].parametersJsonSchema).toEqual(orderSchema);
  });

  it('adds empty properties for OpenAI when a schema has none', () => {
    const tool: ToolDefinition = { name: 'now', description: 'Current time', inputSchema: { type: 'object' } };
    expect(toOpenAITools([tool])[0].function.parameters).toEqual({ type: 'object', properties: {} });
    expect(toClaudeTools([tool])[0].input_schema).toEqual({ type: 'object' });
  });
});

describe('validateTools', () => {
  it('accepts valid tools in both forms', () => {
    expect(() => validateTools([orderTool, toolToDefinition(new LeadCaptureTool())])).not.toThrow();
  });

  it('lists every problem at once', () => {
    const tools = [
      { name: 'get weather', description: 'x', inputSchema: { type: 'object' } },
      { name: 'dup', description: 'x' },
      { name: 'dup', description: 'x' },
      { name: '9lives', description: 'x' },
      { name: 'array_root', description: 'x', inputSchema: { type: 'array' } },
      { name: 'both', description: 'x', inputSchema: { type: 'object' }, parameters: {} },
      { name: 'missing_required', description: 'x', parameters: { a: { type: 'string', description: 'a' } }, required: ['b'] },
      { name: 'no_description' },
    ] as ToolDefinition[];

    let error: unknown;
    try {
      validateTools(tools);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ToolDefinitionError);
    const problems = (error as ToolDefinitionError).problems;
    expect(problems).toHaveLength(7);
    expect(problems.join('\n')).toMatch(/"get weather": the name/);
    expect(problems.join('\n')).toMatch(/"dup": another tool has the same name/);
    expect(problems.join('\n')).toMatch(/"9lives": the name/);
    expect(problems.join('\n')).toMatch(/"array_root": inputSchema must be a JSON Schema with type: 'object'/);
    expect(problems.join('\n')).toMatch(/"both": set inputSchema or parameters, not both/);
    expect(problems.join('\n')).toMatch(/"missing_required": required lists "b"/);
    expect(problems.join('\n')).toMatch(/"no_description": description must be a string/);
    expect((error as Error).message).toContain('Invalid tool definitions:');
  });

  it('rejects a schema that is not plain JSON', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic.self = cyclic;
    expect(() => validateTools([{ name: 'loop', description: 'x', inputSchema: cyclic }])).toThrow(/plain JSON/);
  });

  it('accepts names up to 64 characters and rejects longer ones', () => {
    expect(() => validateTools([{ name: 'a'.repeat(64), description: '' }])).not.toThrow();
    expect(() => validateTools([{ name: 'a'.repeat(65), description: '' }])).toThrow(ToolDefinitionError);
  });
});
