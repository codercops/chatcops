/**
 * Example: Vercel API Route
 *
 * Place this file at: api/chat.ts, and add api/chat/session.ts with
 *   export { default, config } from '../chat';
 * so the widget can get its session token there.
 * Set env vars: ANTHROPIC_API_KEY, and CHATCOPS_SESSION_SECRET (`openssl rand -base64 32`)
 */
import { chatcopsVercelHandler } from '@chatcops/server';

export const config = { runtime: 'edge' };

export default chatcopsVercelHandler({
  provider: {
    type: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
  systemPrompt: 'You are a helpful assistant.',
  allowedOrigins: ['*'],
  // Signs the session tokens the widget fetches before it chats (`openssl rand -base64 32`).
  sessionSecrets: [process.env.CHATCOPS_SESSION_SECRET ?? ''],
});
