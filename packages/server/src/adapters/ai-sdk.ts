import { cloudflareClientIp, fetchClientIp } from '../client-ip.js';
import { createChatHandler } from '../handler.js';
import { fetchChatResponse } from '../http.js';
import { originPolicy } from '../security/origin-policy.js';
import type { ChatCopsServerConfig } from '../config.js';

/**
 * A Fetch API handler that `useChat` from the AI SDK can talk to: it reads
 * the AI SDK's request and answers in its UI message stream. Use it as a
 * Next.js route handler or anywhere that takes `(request) => Response`.
 *
 * The server keeps the conversation (keyed by the chat `id`) and reads only
 * the last user message, unlike AI SDK routes that take the whole history
 * from the client.
 */
export function chatcopsAiSdkHandler(config: ChatCopsServerConfig) {
  const chat = createChatHandler(config);
  const origins = originPolicy(config);

  return function handler(req: Request): Promise<Response> {
    return fetchChatResponse(chat, origins, req, {
      clientIp: (request) => (onWorkers() ? cloudflareClientIp(request, config.clientIp) : fetchClientIp(request, config.clientIp)),
      aiSdk: true,
    });
  };
}

function onWorkers(): boolean {
  return (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent === 'Cloudflare-Workers';
}
