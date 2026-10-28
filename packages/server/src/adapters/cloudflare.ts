import { cloudflareClientIp } from '../client-ip.js';
import { createChatHandler } from '../handler.js';
import { fetchChatResponse } from '../http.js';
import { originPolicy } from '../security/origin-policy.js';
import type { ChatCopsServerConfig } from '../config.js';

export function chatcopsCloudflareHandler(config: ChatCopsServerConfig) {
  const chat = createChatHandler(config);
  const origins = originPolicy(config);

  // Workers call fetch(request, env, ctx); ctx.waitUntil keeps lead webhooks
  // running after a visitor disconnects.
  return function handler(
    request: Request,
    _env?: unknown,
    ctx?: { waitUntil?(promise: Promise<unknown>): void }
  ): Promise<Response> {
    return fetchChatResponse(chat, origins, request, {
      clientIp: (req) => cloudflareClientIp(req, config.clientIp, chat.logger),
      ...(ctx?.waitUntil ? { waitUntil: (promise: Promise<unknown>) => ctx.waitUntil?.(promise) } : {}),
    });
  };
}
