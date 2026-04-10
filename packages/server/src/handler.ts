import {
  createProvider,
  ConversationManager,
  AnalyticsCollector,
  toolToDefinition,
  type ChatMessage,
} from '@chatcops/core';
import type { ChatCopsServerConfig, ValidatedChatRequest } from './config.js';
import { chatRequestSchema } from './config.js';
import { RateLimiter } from './rate-limit.js';
import { WebhookDispatcher } from './webhook.js';

export function createChatHandler(config: ChatCopsServerConfig) {
  const providerPromise = createProvider(config.provider);
  const conversations = new ConversationManager();
  const rateLimiter = config.rateLimit ? new RateLimiter(config.rateLimit) : new RateLimiter();
  const analytics = config.analytics ? new AnalyticsCollector() : null;
  const webhooks = config.webhooks?.length ? new WebhookDispatcher(config.webhooks) : null;
  const toolDefs = config.tools?.map(toolToDefinition) ?? [];
  const toolsByName = new Map((config.tools ?? []).map((tool) => [tool.name, tool]));

  // Periodic cleanup
  const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 60_000);

  async function* handleChat(
    body: unknown,
    clientIp?: string
  ): AsyncGenerator<string> {
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

    if (req.regenerate) {
      const existingMessages = await conversations.getMessages(req.conversationId);
      const lastAssistant = [...existingMessages].reverse().find((message) => message.role === 'assistant');
      if (lastAssistant) {
        await conversations.removeMessage(req.conversationId, lastAssistant.id);
      }
    }

    const conversationMessages = await conversations.getMessages(req.conversationId);

    // Track analytics
    if (analytics && conversationMessages.length === 0) {
      analytics.track('conversation:started', { conversationId: req.conversationId });
    }
    analytics?.track('message:sent', { conversationId: req.conversationId });

    // Add user message unless this is a regenerate request or a retry of the same message
    const hasExistingUserMessage = req.messageId
      ? conversationMessages.some((message) => message.id === req.messageId)
      : false;

    if (!req.regenerate && !hasExistingUserMessage) {
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

    // Add page context
    if (req.pageContext) {
      systemPrompt += `\n\nThe user is currently on: ${req.pageContext.url} (${req.pageContext.title})`;
      if (req.pageContext.description) {
        systemPrompt += `\nPage description: ${req.pageContext.description}`;
      }
    }

    // Add user data from pre-chat form
    if (req.userData && Object.keys(req.userData).length > 0) {
      const userInfo = Object.entries(req.userData)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ');
      systemPrompt += `\n\nUser information: ${userInfo}`;
    }

    // Add locale info
    if (req.locale) {
      systemPrompt += `\n\nRespond in the user's language. Current locale: ${req.locale}`;
    }

    // Get conversation messages for context
    const messages = await conversations.getMessages(req.conversationId);

    // Stream response
    let fullResponse = '';
    const pendingEvents: string[] = [];
    try {
      for await (const chunk of provider.chat({
        messages,
        systemPrompt,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        toolTimeoutMs: config.toolTimeoutMs,
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
              await webhooks.dispatch('lead:captured', {
                lead: result.data,
                conversationId: req.conversationId,
              });
            }
          }

          return result;
        },
      })) {
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
      console.error('[chatcops] Provider error:', err);
      yield JSON.stringify({ error: 'provider_error' });
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
      analytics?.track('message:received', { conversationId: req.conversationId });
    }

    yield JSON.stringify({ done: true });
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
