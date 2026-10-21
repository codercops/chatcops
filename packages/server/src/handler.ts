import {
  createProvider,
  isAIProvider,
  ConversationManager,
  AnalyticsCollector,
  runTurn,
  toLegacyChunk,
  toolRegistry,
  toolToDefinition,
  validateTools,
  type ChatMessage,
  type WirePart,
} from '@chatcops/core';
import type { ChatCopsServerConfig, ValidatedChatRequest } from './config.js';
import { chatRequestSchema } from './config.js';
import { VISITOR_CONTEXT_INSTRUCTION, buildVisitorContext, isLocaleTag, withVisitorContext } from './visitor-context.js';
import { RateLimiter } from './rate-limit.js';
import { WebhookDispatcher } from './webhook.js';

export function createChatHandler(config: ChatCopsServerConfig) {
  if (config.i18n) {
    console.warn('[chatcops] The `i18n` option is deprecated and ignored. Set the widget text with its `strings` option.');
  }

  const providerPromise = isAIProvider(config.provider)
    ? Promise.resolve(config.provider)
    : createProvider(config.provider);
  // A failed setup (unknown provider type, SDK that throws on a missing key)
  // is logged once here and reported to visitors per request below. Without
  // this handler it would be an unhandled rejection and stop the process.
  // Only the message is logged: SDK errors can carry the config or headers.
  providerPromise.catch((err) => {
    console.error('[chatcops] Provider setup failed:', err instanceof Error ? err.message : String(err));
  });
  const conversations = new ConversationManager({ store: config.conversationStore });
  const rateLimiter = config.rateLimit ? new RateLimiter(config.rateLimit) : new RateLimiter();
  const analytics = config.analytics ? new AnalyticsCollector() : null;
  const webhooks = config.webhooks?.length ? new WebhookDispatcher(config.webhooks) : null;
  const toolDefs = config.tools?.map(toolToDefinition) ?? [];
  // A broken tool definition is a code mistake, so fail here, at startup,
  // rather than as a provider error on the first message.
  validateTools(toolDefs);
  const tools = toolRegistry(config.tools);

  // Periodic cleanup
  const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 60_000);

  /**
   * Streams one reply. Pass `options.signal` to stop when the visitor goes
   * away: the provider request is cancelled, nothing more is yielded, and the
   * partial reply isn't saved.
   */
  async function* handleChat(
    body: unknown,
    clientIp?: string,
    options: { signal?: AbortSignal } = {}
  ): AsyncGenerator<string> {
    const { signal } = options;
    // Validate request
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      yield JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const req: ValidatedChatRequest = parsed.data;

    // Rate limit
    if (clientIp) {
      const limit = rateLimiter.check(clientIp);
      if (!limit.allowed) {
        yield JSON.stringify({ error: 'rate_limit', retryAfter: limit.retryAfter });
        return;
      }
    }

    let provider: Awaited<typeof providerPromise>;
    try {
      provider = await providerPromise;
    } catch {
      // Already logged where the provider was created.
      yield JSON.stringify({ error: 'provider_error' });
      return;
    }

    // One reply per conversation at a time: a second request while a reply
    // is being written would otherwise answer the same history twice.
    const release = await conversations.acquireTurn(req.conversationId);
    if (!release) {
      yield legacy({ type: 'error', code: 'conversation_busy', retryable: true });
      return;
    }

    const pendingWebhooks = new Set<Promise<void>>();
    try {
      yield* reply(provider, req, signal, pendingWebhooks);
    } finally {
      await release();
    }
    // Keeping the generator open until lead webhooks finish keeps serverless
    // runtimes from cutting them off once the response ends.
    await awaitPendingWebhooks(pendingWebhooks);
  }

  async function* reply(
    provider: Awaited<typeof providerPromise>,
    req: ValidatedChatRequest,
    signal: AbortSignal | undefined,
    pendingWebhooks: Set<Promise<void>>
  ): AsyncGenerator<string> {
    // Get or create conversation
    await conversations.getOrCreate(req.conversationId);

    const conversationMessages = await conversations.getMessages(req.conversationId);

    let assistantToReplace: ChatMessage | undefined;
    if (req.regenerate) {
      const userIndex = req.messageId
        ? conversationMessages.findIndex((message) => message.id === req.messageId)
        : findLastIndex(conversationMessages, (message) => message.role === 'user');

      if (userIndex !== -1) {
        assistantToReplace = conversationMessages.slice(userIndex + 1).find((message) => message.role === 'assistant');
      } else if (!req.messageId) {
        assistantToReplace = [...conversationMessages].reverse().find((message) => message.role === 'assistant');
      }
    }

    // Track analytics
    if (analytics && conversationMessages.length === 0) {
      analytics.track('conversation:started', { conversationId: req.conversationId });
    }
    analytics?.track('message:sent', { conversationId: req.conversationId });

    // Add user message unless this is a retry of the same message or a regenerate request that already has a user message
    const hasExistingUserMessage = req.messageId
      ? conversationMessages.some((message) => message.id === req.messageId)
      : false;
    const hasUserMessageToAnswer = req.messageId
      ? hasExistingUserMessage
      : conversationMessages.some((message) => message.role === 'user');

    const shouldAddUserMessage = req.regenerate
      ? !hasUserMessageToAnswer
      : !hasExistingUserMessage;

    if (shouldAddUserMessage) {
      const userMessage: ChatMessage = {
        id: req.messageId ?? crypto.randomUUID(),
        role: 'user',
        content: req.message,
        timestamp: Date.now(),
      };
      await conversations.addMessage(req.conversationId, userMessage);
    }

    // The system prompt is the operator's text and nothing else, so it's the
    // same on every request and providers can cache it. Everything that
    // changes per request goes in the context after it.
    const context: string[] = [];
    if (config.knowledge?.length) {
      const contexts = await Promise.all(config.knowledge.map((k) => k.getContext(req.message)));
      const combined = contexts.filter(Boolean).join('\n\n');
      if (combined) context.push(combined);
    }

    // Visitor-supplied page context and pre-chat answers never go into the
    // system prompt; see visitor-context.ts.
    const visitorContext = buildVisitorContext(req);
    if (visitorContext) context.push(VISITOR_CONTEXT_INSTRUCTION);

    if (req.locale && isLocaleTag(req.locale)) {
      context.push(`Reply in the visitor's language. Their browser locale is ${req.locale}.`);
    }

    // The history the model sees, trimmed to the token budget
    const storedMessages = await conversations.getHistory(req.conversationId);
    const messages = withVisitorContext(
      assistantToReplace
        ? storedMessages.filter((message) => message.id !== assistantToReplace.id)
        : storedMessages,
      visitorContext
    );

    // The reply is saved as it grows: appended after the first tool round,
    // updated after each one. A reply that fails before anything was saved
    // isn't saved at all, so a failed regenerate keeps the old answer.
    let saved = false;
    const turn = runTurn({
      provider,
      messages,
      systemPrompt: config.systemPrompt,
      ...(context.length ? { systemContext: context.join('\n\n') } : {}),
      tools,
      conversationId: req.conversationId,
      toolTimeoutMs: config.toolTimeoutMs,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      signal,
      onPart: (part) => {
        if (part.type !== 'lead-captured') return;
        analytics?.track('lead:captured', { conversationId: req.conversationId });
        if (!webhooks) return;
        const delivery = webhooks
          .dispatch('lead:captured', { lead: part.lead, conversationId: req.conversationId })
          .catch((err) => {
            console.error('[chatcops] Webhook delivery failed:', err);
          })
          .finally(() => {
            pendingWebhooks.delete(delivery);
          });
        pendingWebhooks.add(delivery);
      },
      onPersist: async (message, { final }) => {
        const complete = message.status === 'complete';
        if (!saved) {
          if (final && (!complete || (!message.content && !message.parts?.length))) return;
          await conversations.appendMessages(req.conversationId, [message]);
          saved = true;
        } else {
          await conversations.updateMessage(req.conversationId, message);
        }
        if (final && complete) {
          if (assistantToReplace) await conversations.removeMessage(req.conversationId, assistantToReplace.id);
          if (message.content) analytics?.track('message:received', { conversationId: req.conversationId });
        }
      },
    });

    // Old widgets read the 0.5 chunk format. An error is held back until the
    // turn has ended, so it goes out after pending lead webhooks, as before.
    let failure: Extract<WirePart, { type: 'error' }> | undefined;
    let next = await turn.next();
    while (!next.done) {
      const part = next.value;
      if (part.type === 'error') failure = part;
      else {
        const chunk = toLegacyChunk(part);
        if (chunk) yield JSON.stringify(chunk);
      }
      next = await turn.next();
    }

    const result = next.value;
    if (result.status === 'aborted') {
      // The visitor left. Let lead webhooks finish, but write nothing else.
      await awaitPendingWebhooks(pendingWebhooks);
      return;
    }
    if (failure) {
      console.error('[chatcops] Provider error:', result.error);
      await awaitPendingWebhooks(pendingWebhooks);
      yield legacy(failure);
    }
  }

  function cleanup() {
    clearInterval(cleanupInterval);
  }

  return {
    handleChat,
    getAnalytics: () => analytics?.getStats() ?? null,
    cleanup,
  };
}

function legacy(part: WirePart): string {
  return JSON.stringify(toLegacyChunk(part) ?? { error: 'provider_error' });
}

async function awaitPendingWebhooks(pendingWebhooks: Set<Promise<void>>): Promise<void> {
  if (pendingWebhooks.size > 0) {
    await Promise.allSettled(Array.from(pendingWebhooks));
    pendingWebhooks.clear();
  }
}

function findLastIndex<T>(array: T[], predicate: (item: T) => boolean): number {
  for (let i = array.length - 1; i >= 0; i--) {
    if (predicate(array[i])) return i;
  }
  return -1;
}

