import type { ChatMessage } from '../types.js';

export interface NormalizedMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Turns stored messages into a history every provider accepts: it starts with
 * a user turn and alternates between user and assistant.
 *
 * - System messages and empty messages are dropped.
 * - Leading assistant turns are dropped (history trimming can leave one first).
 * - Consecutive turns with the same role are merged with a blank line, for
 *   example a user message saved before a provider call that then failed.
 */
export function normalizeHistory(messages: ChatMessage[]): NormalizedMessage[] {
  const normalized: NormalizedMessage[] = [];

  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (!message.content.trim()) continue;
    if (normalized.length === 0 && message.role !== 'user') continue;

    const previous = normalized.at(-1);
    if (previous && previous.role === message.role) {
      previous.content += `\n\n${message.content}`;
    } else {
      normalized.push({ role: message.role, content: message.content });
    }
  }

  return normalized;
}

/**
 * A rough token count for budgeting, on the high side: about 3.5 characters
 * per token for English, plus a few tokens of per-message overhead. Real
 * counts differ by model; this only has to keep a long conversation from
 * growing without bound.
 */
export function estimateTokens(message: Pick<ChatMessage, 'content'>): number {
  return Math.ceil(message.content.length / 3.5) + 4;
}

/** History budget used when nothing else is configured. */
export const DEFAULT_MAX_HISTORY_TOKENS = 32_000;

/**
 * Keeps a conversation within a token budget before it goes to the model.
 * The first user message stays (it usually says what the visitor came for),
 * then as many of the newest messages as fit. The result never starts with
 * an assistant turn. System messages are left out, since the system prompt
 * is sent separately.
 *
 * Nothing stored changes; this only shapes what the model sees.
 */
export function trimHistory(
  messages: ChatMessage[],
  maxTokens: number = DEFAULT_MAX_HISTORY_TOKENS
): ChatMessage[] {
  const turns = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const total = turns.reduce((sum, m) => sum + estimateTokens(m), 0);
  if (total <= maxTokens) return turns;

  const firstUserIndex = turns.findIndex((m) => m.role === 'user');
  if (firstUserIndex === -1) return [];
  const firstUser = turns[firstUserIndex];
  let budget = maxTokens - estimateTokens(firstUser);

  const recent: ChatMessage[] = [];
  for (let i = turns.length - 1; i > firstUserIndex; i--) {
    const cost = estimateTokens(turns[i]);
    if (cost > budget) break;
    budget -= cost;
    recent.unshift(turns[i]);
  }

  // Start the kept tail on a user turn, so the model doesn't see the first
  // question followed by an answer to something it never saw.
  while (recent.length > 0 && recent[0].role !== 'user') recent.shift();

  // Always keep the latest message, even when it alone is over the budget:
  // without it there's nothing to answer.
  const latest = turns.at(-1);
  if (recent.length === 0 && latest && latest !== firstUser) return [firstUser, latest];
  return [firstUser, ...recent];
}
