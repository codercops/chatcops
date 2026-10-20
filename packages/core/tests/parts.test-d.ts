import { describe, expectTypeOf, it } from 'vitest';
import type { ChatMessage, MessagePart, ToolCallPart } from '../src/types.js';

describe('message part types', () => {
  it('has the documented part types', () => {
    expectTypeOf<MessagePart['type']>().toEqualTypeOf<
      'text' | 'reasoning' | 'source' | 'tool-call' | 'tool-result' | 'lead-captured' | 'handoff'
    >();
  });

  it('narrows a tool call', () => {
    expectTypeOf<Extract<MessagePart, { type: 'tool-call' }>>().toEqualTypeOf<ToolCallPart>();
    expectTypeOf<ToolCallPart['executor']>().toEqualTypeOf<'server' | 'client' | 'mcp'>();
  });

  // Stores written for 0.4 only know these fields, so the new ones stay optional.
  it('keeps a 0.4 message valid', () => {
    expectTypeOf<{ id: string; role: 'user'; content: string; timestamp: number }>().toExtend<ChatMessage>();
  });
});
