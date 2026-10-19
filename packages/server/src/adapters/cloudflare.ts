import { createChatHandler } from '../handler.js';
import type { ChatCopsServerConfig } from '../config.js';

export function chatcopsCloudflareHandler(config: ChatCopsServerConfig) {
  const { handleChat } = createChatHandler(config);
  const corsOrigin = config.cors ?? '*';

  function errorResponse(status: number, error: string): Response {
    return new Response(JSON.stringify({ error }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
      },
    });
  }

  return async function handler(request: Request): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': corsOrigin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed');
    }

    const clientIp = request.headers.get('cf-connecting-ip') ?? 'unknown';
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    (async () => {
      try {
        for await (const chunk of handleChat(body, clientIp)) {
          await writer.write(encoder.encode(`data: ${chunk}\n\n`));
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: 'internal_error' })}\n\n`));
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': corsOrigin,
      },
    });
  };
}
