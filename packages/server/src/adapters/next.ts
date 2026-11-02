import { fetchClientIp } from '../client-ip.js';
import { createChatHandler } from '../handler.js';
import { fetchChatResponse } from '../http.js';
import { originPolicy } from '../security/origin-policy.js';
import type { ChatCopsServerConfig } from '../config.js';

export function chatcopsNext(config: ChatCopsServerConfig) {
  const chat = createChatHandler(config);
  const origins = originPolicy(config);

  const handler = (req: Request): Promise<Response> => {
    return fetchChatResponse(chat, origins, req, {
      clientIp: (request) => fetchClientIp(request, config.clientIp, chat.logger),
    });
  };

  return {
    POST: handler,
    OPTIONS: handler,
  };
}
