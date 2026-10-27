import { segmentWords } from '../storage/memory-vectors.js';
import type { ChatMessage } from '../types.js';

/** A message this short is probably a follow-up that needs the one before it. */
const SHORT_WORDS = 8;

/** How follow-up questions often start ("and the price?", "what about Berlin?"). */
const FOLLOW_UP = /^(and|also|or|but|so|then|what about|how about|what if|how much|how long|is it|does it|can it|are they|do they)\b/i;

/**
 * The text to search for: the visitor's latest message, plus their previous
 * message when the latest is short or reads like a follow-up. "How long does
 * it take?" on its own finds nothing; after "Do you ship to Canada?" it does.
 */
export function retrievalQueryText(text: string, history: ChatMessage[] = []): string {
  const latest = text.trim();
  const followUp = segmentWords(latest).length < SHORT_WORDS || FOLLOW_UP.test(latest);
  if (!followUp) return latest;
  const previous = [...history].reverse().find((message) => message.role === 'user' && message.content.trim());
  return previous ? `${previous.content.trim()}\n${latest}` : latest;
}
