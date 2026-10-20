import {
  createProvider,
  ConversationManager,
  AnalyticsCollector,
  toolToDefinition,
  type ChatMessage,
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

  const providerPromise = createProvider(config.provider);
  const conversations = new ConversationManager({ store: config.conversationStore });
  const rateLimiter = config.rateLimit ? new RateLimiter(config.rateLimit) : new RateLimiter();
  const analytics = config.analytics ? new AnalyticsCollector() : null;
  const webhooks = config.webhooks?.length ? new WebhookDispatcher(config.webhooks) : null;
  const toolDefs = config.tools?.map(toolToDefinition) ?? [];
  const toolsByName = new Map((config.tools ?? []).map((tool) => [tool.name, tool]));

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
    const provider = await providerPromise;
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

    // Build system prompt
    let systemPrompt = config.systemPrompt;

    // Add knowledge context
    if (config.knowledge?.length) {
      const contexts = await Promise.all(
        config.knowledge.map((k) => k.getContext(req.message))
      );
      const combined = contexts.filter(Boolean).join('\n\n');
      if (combined) {
        systemPrompt += '\n\n' + combined;
      }
    }

    // Visitor-supplied page context and pre-chat answers never go into the
    // system prompt; see visitor-context.ts.
    const visitorContext = buildVisitorContext(req);
    if (visitorContext) {
      systemPrompt += `\n\n${VISITOR_CONTEXT_INSTRUCTION}`;
    }

    if (req.locale && isLocaleTag(req.locale)) {
      systemPrompt += `\n\nReply in the visitor's language. Their browser locale is ${req.locale}.`;
    }

    // Get conversation messages for context
    const storedMessages = await conversations.getMessages(req.conversationId);
    const messages = withVisitorContext(
      assistantToReplace
        ? storedMessages.filter((message) => message.id !== assistantToReplace.id)
        : storedMessages,
      visitorContext
    );

    // Stream response
    let fullResponse = '';
    const pendingEvents: string[] = [];
    const pendingWebhooks = new Set<Promise<void>>();
    try {
      for await (const chunk of provider.chat({
        messages,
        systemPrompt,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        toolTimeoutMs: config.toolTimeoutMs,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        signal,
        toolExecutor: async (toolCall) => {
          const tool = toolsByName.get(toolCall.name);
          if (!tool) {
            return {
              success: false,
              message: `Unknown tool: ${toolCall.name}`,
            };
          }

          const result = await tool.execute(toolCall.input);

          if (tool.name === 'capture_lead' && result.success) {
            analytics?.track('lead:captured', { conversationId: req.conversationId });
            pendingEvents.push(JSON.stringify({
              leadCaptured: true,
              leadData: result.data,
            }));
            if (webhooks) {
              const delivery = webhooks
                .dispatch('lead:captured', {
                  lead: result.data,
                  conversationId: req.conversationId,
                })
                .catch((err) => {
                  console.error('[chatcops] Webhook delivery failed:', err);
                })
                .finally(() => {
                  pendingWebhooks.delete(delivery);
                });
              pendingWebhooks.add(delivery);
            }
          }

          return result;
        },
      })) {
        if (signal?.aborted) break;
        while (pendingEvents.length > 0) {
          yield pendingEvents.shift()!;
        }
        fullResponse += chunk;
        yield JSON.stringify({ content: chunk });
      }

      while (pendingEvents.length > 0) {
        yield pendingEvents.shift()!;
      }
    } catch (err) {
      if (signal?.aborted) {
        // The visitor left. Let lead webhooks finish, but write nothing else.
        await awaitPendingWebhooks(pendingWebhooks);
        return;
      }
      console.error('[chatcops] Provider error:', err);
      await awaitPendingWebhooks(pendingWebhooks);
      yield JSON.stringify({ error: 'provider_error' });
      return;
    }

    if (signal?.aborted) {
      await awaitPendingWebhooks(pendingWebhooks);
      return;
    }

    // Save assistant message
    if (fullResponse) {
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullResponse,
        timestamp: Date.now(),
      };
      await conversations.addMessage(req.conversationId, assistantMessage);
      if (assistantToReplace) {
        await conversations.removeMessage(req.conversationId, assistantToReplace.id);
      }
      analytics?.track('message:received', { conversationId: req.conversationId });
    }

    // The reply is finished for the visitor, so say so first. Keeping the generator
    // open until lead webhooks finish keeps serverless runtimes from cutting
    // them off once the response ends.
    yield JSON.stringify({ done: true });
    await awaitPendingWebhooks(pendingWebhooks);
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

