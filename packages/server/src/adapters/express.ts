import type { Request, Response, NextFunction } from 'express';
import { createChatHandler } from '../handler.js';
import type { ChatCopsServerConfig } from '../config.js';

type ChatHandler = ReturnType<typeof createChatHandler>;

const chatHandlers = new WeakMap<ChatCopsServerConfig, ChatHandler>();

function getOrCreateChatHandler(config: ChatCopsServerConfig): ChatHandler {
  let handler = chatHandlers.get(config);
  if (!handler) {
    handler = createChatHandler(config);
    chatHandlers.set(config, handler);
  }
  return handler;
}

export function chatcopsMiddleware(config: ChatCopsServerConfig) {
  const { handleChat } = getOrCreateChatHandler(config);
  const corsOrigin = config.cors ?? '*';

  function sendError(res: Response, status: number, error: string) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.status(status).json({ error });
  }

  return async function chatcopsHandler(req: Request, res: Response, _next: NextFunction) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      sendError(res, 405, 'Method not allowed');
      return;
    }

    const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);

    // Stop the reply when the visitor goes away before it's done.
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    try {
      for await (const chunk of handleChat(req.body, clientIp, { signal: abort.signal })) {
        if (abort.signal.aborted) break;
        res.write(`data: ${chunk}\n\n`);
      }
      if (!abort.signal.aborted) res.write('data: [DONE]\n\n');
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('[chatcops] Unhandled error while handling chat:', err);
        res.write(`data: ${JSON.stringify({ error: 'internal_error' })}\n\n`);
      }
    } finally {
      res.end();
    }
  };
}

export function chatcopsAnalyticsHandler(config: ChatCopsServerConfig) {
  const { getAnalytics } = getOrCreateChatHandler(config);
  return (_req: Request, res: Response) => {
    res.json(getAnalytics());
  };
}
