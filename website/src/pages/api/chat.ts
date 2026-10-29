import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { env } from 'cloudflare:workers';
import { chatcopsCloudflareHandler } from '@chatcops/server/cloudflare';
import { cloudflareStorage, type D1Database } from '@chatcops/store-cloudflare';
import { docsBotFaq, docsBotSystemPrompt } from '../../lib/docs-bot';
import { docsKnowledge } from '../../lib/docs-index';

export const prerender = false;

// Built on the first request rather than at import: the API key is a Worker
// secret that only exists inside a request.
//
// With the CHATCOPS_DB binding (wrangler.jsonc), conversations, limits and
// turn locks live in D1 and hold across every isolate; without it, in memory.
// With the CHATCOPS_SESSION_SECRET secret, the chat needs session tokens.
let chat: ReturnType<typeof chatcopsCloudflareHandler> | undefined;
function getChat() {
  chat ??= chatcopsCloudflareHandler({
    provider: {
      type: 'openai',
      apiKey: getSecret('OPENAI_API_KEY') ?? '',
    },
    systemPrompt: docsBotSystemPrompt,
    // The docs pages, so answers cite the page they come from, then the FAQ.
    knowledge: [docsKnowledge(readAsset, getSecret('OPENAI_API_KEY') ?? ''), docsBotFaq],
    allowedOrigins: [
      'https://chat.codercops.com',
      ...(import.meta.env.DEV ? ['http://localhost:4321'] : []),
    ],
    // Cloudflare sets this header. Only local dev trusts the forwarded fallback.
    clientIp: (request) =>
      request.headers.get('cf-connecting-ip') ??
      (import.meta.env.DEV ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined),
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
    ...storageOptions(),
  });
  return chat;
}

/** A file of the docs index (public/docs-index/), from the Worker's static assets. */
async function readAsset(name: string): Promise<ArrayBuffer> {
  const assets = (env as { ASSETS: { fetch(request: Request): Promise<Response> } }).ASSETS;
  const response = await assets.fetch(new Request(`https://assets.local/docs-index/${name}`));
  if (!response.ok) throw new Error(`The docs index file ${name} is missing (HTTP ${response.status}).`);
  return response.arrayBuffer();
}

function storageOptions() {
  const db = (env as { CHATCOPS_DB?: D1Database }).CHATCOPS_DB;
  const sessionSecret = getSecret('CHATCOPS_SESSION_SECRET');
  return {
    ...(db ? { storage: cloudflareStorage({ d1: db }), retention: { conversationsDays: 30 } } : {}),
    ...(sessionSecret ? { sessionSecrets: [sessionSecret] } : {}),
    // Widgets cached from before 0.6 don't send tokens, and without the
    // secret there are none to send.
    allowAnonymous: true,
  };
}

export const POST: APIRoute = ({ request, locals }) => getChat()(request, undefined, locals.cfContext);

export const OPTIONS: APIRoute = ({ request, locals }) => getChat()(request, undefined, locals.cfContext);
