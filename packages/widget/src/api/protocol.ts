/**
 * The protocol v1 parts the widget reads, copied from `@chatcops/core`
 * (`packages/core/src/protocol/v1.ts`) so the widget's types don't depend on
 * core. `tests/protocol.test-d.ts` fails if core changes them.
 */
export type WirePart =
  | { type: 'start'; protocol: 1; conversationId: string; messageId: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'lead-captured'; lead: Record<string, unknown> }
  | { type: 'error'; code: string; message?: string; retryable: boolean; retryAfterMs?: number; scope?: string }
  | { type: 'finish'; reason: string }
  /** Parts the widget doesn't use yet. */
  | { type: 'text-start' | 'text-end' | 'source' | 'tool-call' | 'tool-result' | 'handoff' | 'agent-message' | 'suggestions' };
