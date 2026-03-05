/**
 * Example: Vercel API Route
 *
 * Place this file at: api/chat.ts
 * Set env vars: ANTHROPIC_API_KEY
 */
import { chatcopsVercelHandler } from '@chatcops/server';

export const config = { runtime: 'edge' };

export default chatcopsVercelHandler({
  provider: {
    type: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  systemPrompt: 'You are a helpful assistant.',
  cors: '*',
});
