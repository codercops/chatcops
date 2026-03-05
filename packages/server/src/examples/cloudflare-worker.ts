/**
 * Example: Cloudflare Worker
 *
 * Set env vars: ANTHROPIC_API_KEY
 */
import { chatcopsCloudflareHandler } from '@chatcops/server';

const handler = chatcopsCloudflareHandler({
  provider: {
    type: 'claude',
    apiKey: '', // Will be set from env
  },
  systemPrompt: 'You are a helpful assistant.',
  cors: '*',
});

export default {
  async fetch(request: Request, env: Record<string, string>): Promise<Response> {
    // Cloudflare Workers don't support top-level env access,
    // so you'd typically create the handler inside fetch.
    // This is simplified for demonstration.
    const cfHandler = chatcopsCloudflareHandler({
      provider: {
        type: 'claude',
        apiKey: env.ANTHROPIC_API_KEY,
      },
      systemPrompt: 'You are a helpful assistant.',
      cors: '*',
    });

    return cfHandler(request);
  },
};
