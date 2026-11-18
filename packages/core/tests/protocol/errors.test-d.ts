import { describe, expectTypeOf, it } from 'vitest';
import type { WireErrorCode, WireErrorBody } from '../../src/protocol/index.js';
import { describeInvalidRequest, errorBody, statusForError } from '../../src/protocol/index.js';

describe('protocol error types', () => {
  it('maps every WireErrorCode to a status number', () => {
    expectTypeOf(statusForError).parameter(0).toEqualTypeOf<WireErrorCode>();
    expectTypeOf(statusForError).returns.toBeNumber();
  });

  it('builds a WireErrorBody', () => {
    expectTypeOf(errorBody).returns.toEqualTypeOf<WireErrorBody>();
  });

  it('describes invalid request from ZodError to string', () => {
    expectTypeOf(describeInvalidRequest).returns.toBeString();
  });
});
