/**
 * Example: Cloudflare Worker
 *
 * Set env vars: ANTHROPIC_API_KEY, and CHATCOPS_SESSION_SECRET (`openssl rand -base64 32`)
 */
import { chatcopsCloudflareHandler } from '@chatcops/server';

// Built on the first request rather than at import, because the API key is a
// Worker secret that only exists inside a request. Caching the handler here is
// what keeps conversation history and rate limiting alive across requests.
let handler: ReturnType<typeof chatcopsCloudflareHandler> | undefined;
function getHandler(env: Record<string, string>) {
  handler ??= chatcopsCloudflareHandler({
    provider: {
      type: 'claude',
      apiKey: env.ANTHROPIC_API_KEY,
    },
    systemPrompt: 'You are a helpful assistant.',
    allowedOrigins: ['*'],
    // Signs the session tokens the widget fetches before it chats.
    sessionSecrets: [env.CHATCOPS_SESSION_SECRET],
  });
  return handler;
}

export default {
  async fetch(request: Request, env: Record<string, string>): Promise<Response> {
    return getHandler(env)(request);
  },
};
