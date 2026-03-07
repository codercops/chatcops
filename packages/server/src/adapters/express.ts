import type { Request, Response, NextFunction } from 'express';
import { createChatHandler } from '../handler.js';
import type { ChatCopsServerConfig } from '../config.js';

export function chatcopsMiddleware(config: ChatCopsServerConfig) {
  const { handleChat, getAnalytics } = createChatHandler(config);

  return async function chatcopsHandler(req: Request, res: Response, next: NextFunction) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', config.cors);
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      res.status(204).end();
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', config.cors);

    try {
      for await (const chunk of handleChat(req.body, clientIp)) {
        res.write(`data: ${chunk}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: 'internal_error' })}\n\n`);
    } finally {
      res.end();
    }
  };
}

export function chatcopsAnalyticsHandler(config: ChatCopsServerConfig) {
  const { getAnalytics } = createChatHandler(config);
  return (_req: Request, res: Response) => {
    res.json(getAnalytics());
  };
}
