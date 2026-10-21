import {
  createProvider,
  isAIProvider,
  ConversationManager,
  AnalyticsCollector,
  createBudgetGuard,
  withDefaultBudgets,
  createRateLimiter,
  memoryStorage,
  partsOf,
  runTurn,
  toLegacyChunk,
  toolRegistry,
  toolToDefinition,
  validateTools,
  type BudgetScope,
  type Budgets,
  type ChatMessage,
  type CounterStore,
  type WirePart,
} from '@chatcops/core';
import type { ChatCopsServerConfig, ValidatedChatRequest } from './config.js';
import { chatRequestSchema } from './config.js';
import { VISITOR_CONTEXT_INSTRUCTION, buildVisitorContext, isLocaleTag, withVisitorContext } from './visitor-context.js';
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
  if (config.storage && config.conversationStore) {
    throw new Error('Set `storage` or `conversationStore`, not both. `storage.conversations` replaces `conversationStore`.');
  }
  if (!config.storage && !config.conversationStore && onServerless() && !warnedMemoryStorage) {
    warnedMemoryStorage = true;
    console.warn(
      '[chatcops] No `storage` is set, so conversations are kept in memory. On serverless each instance has its own memory, so a conversation can lose its history between messages. Use a store package such as @chatcops/store-postgres or @chatcops/store-redis.'
    );
  }
  const storage = config.storage ?? (config.conversationStore ? { conversations: config.conversationStore } : undefined);
  const conversations = new ConversationManager(storage ? { storage } : {});
  // Counted in the storage's counters when it has them, so limits and
  // budgets hold across every server instance; otherwise in this process.
  // Nothing runs on a timer, which Workers don't allow at global scope.
  const counters = (storage?.counters ?? memoryStorage().counters) as CounterStore;
  const budgets = withDefaultBudgets(config.budgets);
  const budgetGuard = budgets ? createBudgetGuard(counters, budgets.budgets) : undefined;
  if (budgets && !loggedBudgets) {
    loggedBudgets = true;
    console.info(describeBudgets(budgets.budgets, budgets.defaulted));
  }
  const rateLimit = { maxRequests: 30, windowMs: 60_000, ...config.rateLimit };
  if (rateLimit.maxRequests <= 0) throw new Error('maxRequests must be greater than 0');
  const rateLimiter = createRateLimiter(counters, {
    limit: rateLimit.maxRequests,
    windowMs: rateLimit.windowMs,
  });
  const analytics = config.analytics ? new AnalyticsCollector() : null;
  const webhooks = config.webhooks?.length ? new WebhookDispatcher(config.webhooks) : null;
  const toolDefs = config.tools?.map(toolToDefinition) ?? [];
  // A broken tool definition is a code mistake, so fail here, at startup,
  // rather than as a provider error on the first message.
  validateTools(toolDefs);
  const tools = toolRegistry(config.tools);


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
      const limit = await rateLimiter.check(clientIp);
      if (!limit.allowed) {
        // 0.5 widgets read seconds.
        yield JSON.stringify({ error: 'rate_limit', retryAfter: Math.ceil((limit.retryAfterMs ?? 1000) / 1000) });
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
      yield* reply(provider, req, signal, pendingWebhooks, clientIp);
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
    pendingWebhooks: Set<Promise<void>>,
    clientIp: string | undefined
  ): AsyncGenerator<string> {
    const conversation = await conversations.getOrCreate(req.conversationId);
    const conversationMessages = conversation.messages;

    // Pre-chat answers are kept from the first message on, so the widget
    // doesn't have to send them again and they can't change mid-conversation.
    const storedVisitor = conversation.metadata?.visitor as Record<string, string> | undefined;
    const newVisitor = storedVisitor ? undefined : allowedUserData(req.userData, config.preChatFields);
    const userData = storedVisitor ?? newVisitor;

    let assistantToReplace: ChatMessage | undefined;
    if (typeof req.regenerate === 'object') {
      const id = req.regenerate.assistantMessageId;
      assistantToReplace = conversationMessages.find((message) => message.id === id && message.role === 'assistant');
    }
    if (req.regenerate && !assistantToReplace) {
      const userIndex = req.messageId
        ? conversationMessages.findIndex((message) => message.id === req.messageId)
        : findLastIndex(conversationMessages, (message) => message.role === 'user');

      if (userIndex !== -1) {
        assistantToReplace = conversationMessages.slice(userIndex + 1).find((message) => message.role === 'assistant');
      } else if (!req.messageId) {
        assistantToReplace = [...conversationMessages].reverse().find((message) => message.role === 'assistant');
      }
    }

    // A retry of a message that already has a finished reply (the network
    // dropped after the server saved it) gets that reply again instead of a
    // second one. A partial reply is replaced once the new one succeeds.
    if (!req.regenerate && req.messageId) {
      const index = conversationMessages.findIndex((message) => message.id === req.messageId && message.role === 'user');
      const answer = index === -1 ? undefined : conversationMessages[index + 1];
      if (answer?.role === 'assistant') {
        if (answer.status === undefined || answer.status === 'complete') {
          yield* replay(answer);
          return;
        }
        assistantToReplace = answer;
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
      await conversations.appendMessages(
        req.conversationId,
        [userMessage],
        newVisitor ? { metadata: { visitor: newVisitor } } : undefined
      );
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
    const visitorContext = buildVisitorContext({ pageContext: req.pageContext, userData });
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
      ...(budgetGuard
        ? { budget: { guard: budgetGuard, context: { conversationId: req.conversationId, ...(clientIp ? { ip: clientIp } : {}) } } }
        : {}),
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
          if (final && !message.content && !message.parts?.length) return;
          // A reply the visitor walked away from is kept, marked `aborted`,
          // so the conversation shows what they saw (the model doesn't see
          // it). When regenerating, the old answer stands instead. A reply
          // that failed isn't kept.
          if (final && !complete && (message.status !== 'aborted' || assistantToReplace)) return;
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
      if (failure.code === 'budget_exceeded') {
        console.warn(`[chatcops] The ${failure.scope ?? ''} budget is used up, so a reply was refused.`);
      } else {
        console.error('[chatcops] Provider error:', result.error);
      }
      await awaitPendingWebhooks(pendingWebhooks);
      yield legacy(failure);
    }
  }

  /**
   * Deletes conversations last updated more than `retention.conversationsDays`
   * (default 30) days ago. Resolves how many, or `null` when the store can't
   * purge.
   */
  async function purge(now = Date.now()): Promise<number | null> {
    const store = storage?.conversations;
    if (!store?.purge) return null;
    const days = config.retention?.conversationsDays ?? 30;
    return store.purge(now - days * DAY_MS);
  }

  /** Kept for compatibility: the handler no longer holds timers, so there's nothing to clean up. */
  function cleanup() {}

  return {
    handleChat,
    purge,
    getAnalytics: () => analytics?.getStats() ?? null,
    cleanup,
  };
}

/** A saved reply, sent again as the 0.5 stream. */
function* replay(message: ChatMessage): Generator<string> {
  for (const part of partsOf(message)) {
    if (part.type === 'text' && part.text) yield JSON.stringify({ content: part.text });
    else if (part.type === 'lead-captured') yield JSON.stringify({ leadCaptured: true, leadData: part.lead });
  }
  yield JSON.stringify({ done: true });
}

/** The pre-chat answers to keep: all of them, or only the configured fields. */
function allowedUserData(
  userData: Record<string, string> | undefined,
  fields: string[] | undefined
): Record<string, string> | undefined {
  if (!userData) return undefined;
  const kept = fields ? Object.fromEntries(Object.entries(userData).filter(([key]) => fields.includes(key))) : userData;
  return Object.keys(kept).length ? kept : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Once per process (per isolate on Workers), not once per handler. */
let warnedMemoryStorage = false;
let loggedBudgets = false;

const SCOPE_LABELS: Record<BudgetScope, string> = { conversation: 'per conversation', ip: 'per IP per day', global: 'per day in total' };

function amount(value: number, unit: string): string {
  const short = value >= 1_000_000 ? `${value / 1_000_000}M` : value >= 1_000 ? `${value / 1_000}k` : String(value);
  return `${short} ${unit}`;
}

/** The startup line, so the limits in force are never a surprise. */
export function describeBudgets(budgets: Budgets, defaulted: BudgetScope[] = []): string {
  const scopes: [BudgetScope, Budgets['globalPerDay']][] = [
    ['conversation', budgets.perConversation],
    ['ip', budgets.perIpPerDay],
    ['global', budgets.globalPerDay],
  ];
  const parts: string[] = [];
  for (const [scope, limit] of scopes) {
    if (!limit) continue;
    const caps = [
      ...(limit.tokens !== undefined ? [amount(limit.tokens, 'tokens')] : []),
      ...(limit.messages !== undefined ? [amount(limit.messages, 'replies')] : []),
      ...(limit.usd !== undefined ? [`$${limit.usd}`] : []),
    ];
    parts.push(`${caps.join(' and ')} ${SCOPE_LABELS[scope]}${defaulted.includes(scope) ? ' (default)' : ''}`);
  }
  const noTotal = budgets.globalPerDay ? '' : ' No daily total is set; `budgets.globalPerDay` caps your whole bill.';
  return `[chatcops] Budgets: ${parts.join(', ')}.${noTotal} Set \`budgets\` to change them, or \`budgets: false\` to turn them off.`;
}

/** Vercel, AWS Lambda, Netlify and Cloudflare Workers, where memory doesn't last. */
function onServerless(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  if (env.VERCEL || env.AWS_LAMBDA_FUNCTION_NAME || env.NETLIFY || env.K_SERVICE) return true;
  return (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent === 'Cloudflare-Workers';
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

