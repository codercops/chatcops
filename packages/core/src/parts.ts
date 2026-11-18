import type { ChatMessage, MessagePart, TextPart } from './types.js';

/**
 * The parts of a message. Messages saved before parts existed only have
 * `content`, which counts as a single text part (none when it's empty).
 */
export function partsOf(message: Pick<ChatMessage, 'content' | 'parts'>): MessagePart[] {
  if (message.parts) return message.parts;
  return message.content ? [{ type: 'text', text: message.content }] : [];
}

/** The text parts joined, which is what `ChatMessage.content` holds. */
export function messageText(parts: readonly MessagePart[]): string {
  return parts
    .filter((part): part is TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
