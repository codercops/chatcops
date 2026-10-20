import type { ChatMessage, Conversation } from '../types.js';
import { ConflictError } from './errors.js';
import type { AppendOptions, ConversationStore } from './types.js';

/** A store with the message-level writes the server uses. */
export type ConversationStoreWithAppend = ConversationStore &
  Required<Pick<ConversationStore, 'append' | 'updateMessage' | 'removeMessage'>>;

/** True when the store only has the 0.4 methods (`get`, `save`, `delete`). */
export function isLegacyConversationStore(store: ConversationStore): boolean {
  return !store.append;
}

/**
 * Gives any store `append`, `updateMessage` and `removeMessage`. Methods the
 * store has are used as they are. The missing ones read the conversation,
 * change it and save it back, one write at a time per conversation within
 * this process. That's safe for a single server, but two instances writing
 * the same conversation can still overwrite each other, which is why stores
 * should implement `append` themselves.
 */
export function withAppend(store: ConversationStore): ConversationStoreWithAppend {
  if (store.append && store.updateMessage && store.removeMessage) {
    return store as ConversationStoreWithAppend;
  }

  const queues = new Map<string, Promise<unknown>>();
  function serialized<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve();
    const run = previous.then(fn, fn);
    const settled = run.then(
      () => undefined,
      () => undefined
    );
    queues.set(id, settled);
    void settled.then(() => {
      if (queues.get(id) === settled) queues.delete(id);
    });
    return run;
  }

  async function rewrite(
    id: string,
    change: (current: Conversation) => Conversation | null
  ): Promise<boolean> {
    const current = await store.get(id);
    if (!current) return false;
    const next = change(current);
    if (!next) return false;
    await store.save({ ...next, version: (current.version ?? 0) + 1, updatedAt: Date.now() });
    return true;
  }

  return {
    get: (id) => store.get(id),
    save: (conversation) => store.save(conversation),
    delete: (id) => store.delete(id),
    ...(store.list ? { list: store.list.bind(store) } : {}),
    ...(store.purge ? { purge: store.purge.bind(store) } : {}),

    append: store.append
      ? store.append.bind(store)
      : (id: string, messages: ChatMessage[], options: AppendOptions = {}) =>
          serialized(id, async () => {
            const current = await store.get(id);
            const version = current?.version ?? 0;
            if (options.expectedVersion !== undefined && options.expectedVersion !== version) {
              throw new ConflictError(id, options.expectedVersion, version);
            }
            const time = Date.now();
            const metadata =
              options.metadata || current?.metadata ? { ...current?.metadata, ...options.metadata } : undefined;
            await store.save({
              id,
              messages: [...(current?.messages ?? []), ...messages],
              ...(metadata ? { metadata } : {}),
              version: version + 1,
              createdAt: current?.createdAt ?? time,
              updatedAt: time,
            });
            return { version: version + 1 };
          }),

    updateMessage: store.updateMessage
      ? store.updateMessage.bind(store)
      : (id: string, message: ChatMessage) =>
          serialized(id, () =>
            rewrite(id, (current) => {
              const index = current.messages.findIndex((m) => m.id === message.id);
              if (index === -1) return null;
              const messages = [...current.messages];
              messages[index] = message;
              return { ...current, messages };
            })
          ),

    removeMessage: store.removeMessage
      ? store.removeMessage.bind(store)
      : (id: string, messageId: string) =>
          serialized(id, () =>
            rewrite(id, (current) =>
              current.messages.some((m) => m.id === messageId)
                ? { ...current, messages: current.messages.filter((m) => m.id !== messageId) }
                : null
            )
          ),
  };
}
