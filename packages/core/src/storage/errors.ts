export const CONFLICT_ERROR_CODE = 'chatcops_conversation_conflict';

/**
 * Thrown by `ConversationStore.append` when `expectedVersion` doesn't match.
 * Another request wrote to the conversation since it was read.
 */
export class ConflictError extends Error {
  readonly code = CONFLICT_ERROR_CODE;

  constructor(
    readonly conversationId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number
  ) {
    super(
      `Conversation ${conversationId} is at version ${actualVersion}, expected ${expectedVersion}. Another request wrote to it first.`
    );
    this.name = 'ConflictError';
  }
}

/**
 * Checks by `code` rather than `instanceof`, so it also works when a store
 * package ends up with its own copy of `@chatcops/core`.
 */
export function isConflictError(error: unknown): error is ConflictError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === CONFLICT_ERROR_CODE
  );
}
