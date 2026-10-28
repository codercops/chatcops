import { uniqueChunks, type ChatMessage, type KnowledgeSource, type RetrievedChunk } from '@chatcops/core';

/** How much of the conversation retrievers see, for follow-up questions. */
const HISTORY_FOR_RETRIEVAL = 6;

/**
 * The knowledge for one message. Sources with `retrieve` get the
 * conversation so far and return chunks, which the turn gives the model as
 * citable sources; older sources return their own text from `getContext`,
 * which goes in the context as before. A source that fails fails the
 * request, as before.
 */
export async function knowledgeContext(
  knowledge: KnowledgeSource[],
  text: string,
  history: ChatMessage[],
  signal?: AbortSignal
): Promise<{ context: string; sources: RetrievedChunk[] }> {
  const recent = history.slice(-HISTORY_FOR_RETRIEVAL);
  const results = await Promise.all(
    knowledge.map(async (source) =>
      source.retrieve ? { chunks: await source.retrieve({ text, history: recent, signal }) } : { text: await source.getContext(text) }
    )
  );
  return {
    context: results.flatMap((result) => (result.text ? [result.text] : [])).join('\n\n'),
    sources: uniqueChunks(results.flatMap((result) => result.chunks ?? [])),
  };
}

/** The messages before the one being answered: all of them for a new message. */
export function historyBefore(messages: ChatMessage[], answering: { messageId?: string; regenerate?: unknown }): ChatMessage[] {
  let index = -1;
  if (answering.messageId) {
    index = messages.findIndex((message) => message.id === answering.messageId);
  } else if (answering.regenerate) {
    for (let i = messages.length - 1; i >= 0 && index === -1; i--) if (messages[i].role === 'user') index = i;
  }
  return index === -1 ? messages : messages.slice(0, index);
}
