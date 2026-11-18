import { describe, expectTypeOf, it } from 'vitest';
import type { ChatRequestV1, WireErrorBody, WirePartType } from '../../src/protocol/index.js';

describe('protocol v1 types', () => {
  // The widget vendors these types, and old widgets talk to new servers for
  // months, so the set of part types only grows. This fails when a part type
  // is renamed or removed.
  it('has the documented part types', () => {
    expectTypeOf<WirePartType>().toEqualTypeOf<
      | 'start'
      | 'text-start'
      | 'text-delta'
      | 'text-end'
      | 'source'
      | 'tool-call'
      | 'tool-result'
      | 'lead-captured'
      | 'handoff'
      | 'agent-message'
      | 'suggestions'
      | 'error'
      | 'finish'
    >();
  });

  it('accepts both regenerate forms', () => {
    expectTypeOf<{ protocol: 1; conversationId: string; regenerate: true }>().toExtend<ChatRequestV1>();
    expectTypeOf<{ protocol: 1; conversationId: string; regenerate: { assistantMessageId: string } }>().toExtend<ChatRequestV1>();
    expectTypeOf<{ protocol: 2; conversationId: string }>().not.toExtend<ChatRequestV1>();
  });

  it('has an error body with a known code', () => {
    expectTypeOf<{ error: { code: 'conversation_busy' } }>().toExtend<WireErrorBody>();
    expectTypeOf<{ error: { code: 'nope' } }>().not.toExtend<WireErrorBody>();
  });
});
