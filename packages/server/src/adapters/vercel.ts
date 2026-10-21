import { fetchClientIp } from '../client-ip.js';
import { createChatHandler } from '../handler.js';
import { originPolicy } from '../security/origin-policy.js';
import type { ChatCopsServerConfig } from '../config.js';

export function chatcopsVercelHandler(config: ChatCopsServerConfig) {
  const { handleChat } = createChatHandler(config);
  const origins = originPolicy(config);

  return async function handler(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    const cors = origins.headers(origin);
    const errorResponse = (status: number, error: string) =>
      new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: origins.preflightHeaders(origin) });
    }

    if (req.method !== 'POST') {
      return errorResponse(405, 'Method not allowed');
    }
    if (!origins.allows(origin)) {
      return errorResponse(403, 'origin_not_allowed');
    }

    const clientIp = fetchClientIp(req, config.clientIp);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const encoder = new TextEncoder();
    // The runtime cancels the response stream when the visitor disconnects.
    const abort = new AbortController();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (text: string) => {
          if (!abort.signal.aborted) controller.enqueue(encoder.encode(text));
        };
        try {
          for await (const chunk of handleChat(body, clientIp, { signal: abort.signal })) {
            if (abort.signal.aborted) break;
            send(`data: ${chunk}\n\n`);
          }
          send('data: [DONE]\n\n');
        } catch (err) {
          if (!abort.signal.aborted) console.error('[chatcops] Unhandled error while handling chat:', err);
          send(`data: ${JSON.stringify({ error: 'internal_error' })}\n\n`);
        } finally {
          if (!abort.signal.aborted) controller.close();
        }
      },
      cancel() {
        abort.abort();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...cors,
      },
    });
  };
}
