import type { WireFinishReason, WirePart } from './v1.js';

/**
 * The AI SDK's UI message stream (what `useChat` reads), so an app built on
 * the AI SDK can point at a ChatCops server. Only the mapping lives here, with
 * no dependency on the `ai` package; `chatcopsAiSdkHandler` in
 * `@chatcops/server` serves it. A contract test pins it to an `ai` version.
 */

/** One UI message stream chunk. See `UIMessageChunk` in the `ai` package. */
export type AiSdkChunk = { type: string } & Record<string, unknown>;

/** The stream header `useChat` checks for. */
export const AI_SDK_STREAM_HEADER = 'x-vercel-ai-ui-message-stream';

const FINISH_REASONS: Record<Exclude<WireFinishReason, 'aborted'>, string> = {
  stop: 'stop',
  length: 'length',
  error: 'error',
  'client-tool-calls': 'tool-calls',
  'approval-required': 'tool-calls',
  handoff: 'other',
};

/**
 * Turns protocol v1 parts into UI message stream chunks, one reply at a
 * time: it remembers which tools ran on the server and whether the reply was
 * filtered.
 */
export function aiSdkEncoder(): (part: WirePart) => AiSdkChunk[] {
  const serverTools = new Set<string>();
  let filtered = false;

  return (part) => {
    switch (part.type) {
      case 'start':
        return [
          { type: 'start', messageId: part.messageId, messageMetadata: { conversationId: part.conversationId } },
          { type: 'start-step' },
        ];
      case 'text-start':
      case 'text-end':
        return [{ type: part.type, id: part.id }];
      case 'text-delta':
        return [{ type: 'text-delta', id: part.id, delta: part.delta }];
      case 'source':
        return [{ type: 'source-url', sourceId: part.sourceId, url: part.url, ...(part.title ? { title: part.title } : {}) }];
      case 'tool-call': {
        // A tool the server ran: `useChat` must not run it or wait for its output.
        const server = part.executor === 'server';
        if (server) serverTools.add(part.toolCallId);
        return [
          {
            type: 'tool-input-available',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.input ?? {},
            ...(server ? { providerExecuted: true } : {}),
            ...(part.title ? { title: part.title } : {}),
          },
        ];
      }
      case 'tool-result': {
        const executed = serverTools.has(part.toolCallId) ? { providerExecuted: true } : {};
        return part.error !== undefined
          ? [{ type: 'tool-output-error', toolCallId: part.toolCallId, errorText: part.error, ...executed }]
          : [{ type: 'tool-output-available', toolCallId: part.toolCallId, output: part.output ?? null, ...executed }];
      }
      case 'lead-captured':
        return [{ type: 'data-lead-captured', data: part.lead }];
      case 'suggestions':
        return [{ type: 'data-suggestions', data: part.items }];
      case 'handoff':
      case 'agent-message': {
        const { type, ...data } = part;
        return [{ type: `data-${type}`, data }];
      }
      case 'error':
        if (part.code === 'content_filtered') filtered = true;
        return [{ type: 'error', errorText: part.message ?? part.code }];
      case 'finish': {
        if (part.reason === 'aborted') return [{ type: 'abort', reason: 'aborted' }];
        const finishReason = filtered ? 'content-filter' : FINISH_REASONS[part.reason];
        return [
          { type: 'finish-step' },
          { type: 'finish', finishReason, ...(part.usage ? { messageMetadata: { usage: part.usage } } : {}) },
        ];
      }
      default:
        return [];
    }
  };
}

interface AiSdkMessage {
  id?: unknown;
  role?: unknown;
  parts?: unknown;
}

/**
 * The ChatCops request for a `useChat` request (`{ id, messages, trigger,
 * messageId }`). Only the last user message is read: the server keeps the
 * history, so a client can't add turns the model never wrote. `pageContext`,
 * `locale` and `userData` pass through from the request body.
 */
export function fromAiSdkRequest(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') return {};
  const { id, messages, trigger, messageId, pageContext, locale, userData } = body as Record<string, unknown>;
  const list = Array.isArray(messages) ? (messages as AiSdkMessage[]) : [];
  const lastUser = [...list].reverse().find((message) => message?.role === 'user');

  const request: Record<string, unknown> = { conversationId: id, message: textOf(lastUser) };
  if (trigger === 'regenerate-message') {
    if (typeof messageId !== 'string') {
      request.regenerate = true;
    } else if (list.some((message) => message?.id === messageId)) {
      // `regenerate({ messageId })` on a user message keeps it in `messages`.
      request.regenerate = true;
      request.messageId = messageId;
    } else {
      request.regenerate = { assistantMessageId: messageId };
    }
  } else if (typeof lastUser?.id === 'string') {
    request.messageId = lastUser.id;
  }
  if (pageContext !== undefined) request.pageContext = pageContext;
  if (locale !== undefined) request.locale = locale;
  if (userData !== undefined) request.userData = userData;
  return request;
}

function textOf(message: AiSdkMessage | undefined): string {
  if (!Array.isArray(message?.parts)) return '';
  return (message.parts as Array<{ type?: unknown; text?: unknown }>)
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n\n');
}
