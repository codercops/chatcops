/**
 * Example: Cloudflare Worker
 *
 * Set env vars: ANTHROPIC_API_KEY
 */
import { chatcopsCloudflareHandler } from '@chatcops/server';

export default {
  async fetch(request: Request, env: Record<string, string>): Promise<Response> {
    const handler = chatcopsCloudflareHandler({
      provider: {
        type: 'claude',
        apiKey: env.ANTHROPIC_API_KEY,
      },
      systemPrompt: 'You are a helpful assistant.',
      cors: '*',
    });

    return handler(request);
  },
};
