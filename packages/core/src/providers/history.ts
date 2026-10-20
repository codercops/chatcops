import { partsOf } from '../parts.js';
import type {
  ChatMessage,
  MessagePart,
  ReasoningPart,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from '../types.js';

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

/** The parts a model sees again on the next request. */
export type TurnPart = TextPart | ReasoningPart | ToolCallPart | ToolResultPart;

export interface NormalizedTurn {
  role: 'user' | 'assistant';
  parts: TurnPart[];
}

/** Stands in for a tool result that was never recorded, so the call isn't left open. */
const NOT_RUN = 'The tool was not run.';

function isTurnPart(part: MessagePart): part is TurnPart {
  switch (part.type) {
    case 'text':
      return part.text.trim() !== '';
    case 'reasoning':
    case 'tool-call':
    case 'tool-result':
      return true;
    default:
      return false;
  }
}

function notRun(call: ToolCallPart): ToolResultPart {
  return { type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName, error: NOT_RUN };
}

/**
 * The parts of one message as the model should see them. Every tool call gets
 * a result: calls whose result was never recorded (a cancelled turn) get a
 * "not run" error, and results without a matching call are dropped, because
 * every provider rejects either kind of loose end.
 */
function turnParts(message: ChatMessage): TurnPart[] {
  let parts = partsOf(message).filter(isTurnPart);

  // An aborted reply ends in half a sentence. Keep the finished tool steps
  // before it and drop the text after the last result.
  if (message.status === 'aborted') {
    let lastResult = -1;
    parts.forEach((part, i) => {
      if (part.type === 'tool-result') lastResult = i;
    });
    parts = parts.filter((part, i) => i <= lastResult || part.type === 'tool-call');
  }

  const out: TurnPart[] = [];
  const known = new Set<string>();
  let open: ToolCallPart[] = [];
  let inResults = false;

  const closeOpenCalls = () => {
    for (const call of open) out.push(notRun(call));
    open = [];
  };

  for (const part of parts) {
    if (part.type === 'tool-result') {
      if (!known.has(part.toolCallId)) continue;
      known.delete(part.toolCallId);
      open = open.filter((call) => call.toolCallId !== part.toolCallId);
      out.push(part);
      inResults = true;
      continue;
    }
    // A model part after results starts the next step, so any call from the
    // last step that still has no result never ran.
    if (inResults) {
      closeOpenCalls();
      inResults = false;
    }
    if (part.type === 'tool-call') {
      known.add(part.toolCallId);
      open.push(part);
    }
    out.push(part);
  }
  closeOpenCalls();
  return out;
}

/**
 * Like `normalizeHistory`, but keeps message parts, so tool calls, their
 * results and reasoning signatures from earlier steps go back to the model.
 *
 * - System messages, empty messages and leading assistant turns are dropped.
 * - Sources, captured leads and handoff notes are dropped; they're for people.
 * - Turns with the same role in a row are merged, and text that meets across
 *   the join is combined with a blank line, as `normalizeHistory` does.
 */
export function normalizeTurns(messages: ChatMessage[]): NormalizedTurn[] {
  const turns: NormalizedTurn[] = [];

  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const parts = turnParts(message);
    if (parts.length === 0) continue;
    if (turns.length === 0 && message.role !== 'user') continue;

    const previous = turns.at(-1);
    if (!previous || previous.role !== message.role) {
      turns.push({ role: message.role, parts });
      continue;
    }

    const last = previous.parts.at(-1);
    const [first, ...rest] = parts;
    if (last?.type === 'text' && first.type === 'text') {
      previous.parts[previous.parts.length - 1] = { ...last, text: `${last.text}\n\n${first.text}` };
      previous.parts.push(...rest);
    } else {
      previous.parts.push(...parts);
    }
  }

  return turns;
}

function partLength(part: MessagePart): number {
  switch (part.type) {
    case 'text':
    case 'reasoning':
      return part.text.length;
    case 'tool-call':
      return part.toolName.length + jsonLength(part.input);
    case 'tool-result':
      return jsonLength(part.output) + (part.error?.length ?? 0);
    default:
      return 0;
  }
}

function jsonLength(value: unknown): number {
  if (value === undefined) return 0;
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * A rough token count for budgeting, on the high side: about 3.5 characters
 * per token for English, plus a few tokens of per-message overhead. Real
 * counts differ by model; this only has to keep a long conversation from
 * growing without bound. Messages with parts are counted by their parts, so
 * tool inputs and results count too.
 */
export function estimateTokens(message: Pick<ChatMessage, 'content' | 'parts'>): number {
  const length = message.parts
    ? message.parts.reduce((sum, part) => sum + partLength(part), 0)
    : message.content.length;
  return Math.ceil(length / 3.5) + 4;
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
