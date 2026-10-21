import { cloudflareClientIp } from '../client-ip.js';
import { createChatHandler } from '../handler.js';
import { originPolicy } from '../security/origin-policy.js';
import type { ChatCopsServerConfig } from '../config.js';

export function chatcopsCloudflareHandler(config: ChatCopsServerConfig) {
  const { handleChat } = createChatHandler(config);
  const origins = originPolicy(config);

  // Workers call fetch(request, env, ctx); ctx.waitUntil keeps lead webhooks
  // running after a visitor disconnects.
  return async function handler(
    request: Request,
    _env?: unknown,
    ctx?: { waitUntil?(promise: Promise<unknown>): void }
  ): Promise<Response> {
    const origin = request.headers.get('origin');
    const cors = origins.headers(origin);
    const errorResponse = (status: number, error: string) =>
      new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: origins.preflightHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed');
    }
    if (!origins.allows(origin)) {
      return errorResponse(403, 'origin_not_allowed');
    }

    const clientIp = cloudflareClientIp(request, config.clientIp);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, 'Invalid JSON body');
    }

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // When the visitor disconnects the runtime cancels the response, which errors
    // the writer right away; abort then, without waiting for the next write.
    const abort = new AbortController();
    writer.closed.catch(() => abort.abort());
    const send = async (text: string): Promise<boolean> => {
      if (abort.signal.aborted) return false;
      try {
        await writer.write(encoder.encode(text));
        return true;
      } catch {
        abort.abort();
        return false;
      }
    };

    const pump = (async () => {
      try {
        for await (const chunk of handleChat(body, clientIp, { signal: abort.signal })) {
          if (!(await send(`data: ${chunk}\n\n`))) break;
        }
        await send('data: [DONE]\n\n');
      } catch (err) {
        if (!abort.signal.aborted) console.error('[chatcops] Unhandled error while handling chat:', err);
        await send(`data: ${JSON.stringify({ error: 'internal_error' })}\n\n`);
      } finally {
        if (abort.signal.aborted) {
          await writer.abort().catch(() => {});
        } else {
          await writer.close().catch(() => {});
        }
      }
    })();
    ctx?.waitUntil?.(pump);

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...cors,
      },
    });
  };
}
