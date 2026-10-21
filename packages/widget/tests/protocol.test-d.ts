import type { WirePart as CoreWirePart } from '@chatcops/core';
import { describe, expectTypeOf, it } from 'vitest';
import type { WirePart } from '../src/api/protocol.js';

describe('the protocol types the widget copies from core', () => {
  it('cover every part core can send', () => {
    // Fails when core adds a part type or changes a field the widget reads.
    // Add the type to src/api/protocol.ts (even if the widget ignores it).
    expectTypeOf<CoreWirePart>().toExtend<WirePart>();
  });

  it('read the fields the widget uses with the same types as core', () => {
    expectTypeOf<Extract<CoreWirePart, { type: 'start' }>['messageId']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<CoreWirePart, { type: 'text-delta' }>['delta']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<CoreWirePart, { type: 'lead-captured' }>['lead']>().toEqualTypeOf<Record<string, unknown>>();
  });
});
