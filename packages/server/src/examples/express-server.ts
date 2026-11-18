/**
 * Example: Express server with ChatCops
 *
 * Run:
 *   npm install express @chatcops/server
 *   ANTHROPIC_API_KEY=sk-... CHATCOPS_SESSION_SECRET=$(openssl rand -base64 32) npx tsx express-server.ts
 */
import express from 'express';
import { chatcopsMiddleware } from '@chatcops/server';

const app = express();
app.use(express.json());

// app.use, not app.all: the widget gets its session token from /chat/session.
app.use('/chat', chatcopsMiddleware({
  provider: {
    type: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-haiku-4-5-20251001',
  },
  systemPrompt: `You are a helpful customer support assistant for Acme Inc.
Be friendly, concise, and helpful. If a user wants to get in touch,
ask for their name, email, and project details to capture as a lead.`,
  allowedOrigins: ['*'],
  // Signs the session tokens the widget fetches before it chats (`openssl rand -base64 32`).
  sessionSecrets: [process.env.CHATCOPS_SESSION_SECRET ?? ''],
  rateLimit: { maxRequests: 30, windowMs: 60_000 },
  analytics: true,
}));

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`ChatCops server running on http://localhost:${PORT}`);
  console.log('Test it: get a session token, then send a message with it:');
  console.log(`  TOKEN=$(curl -s -X POST http://localhost:${PORT}/chat/session -H 'Content-Type: application/json' -d '{"conversationId":"test"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')`);
  console.log(`  curl -N -X POST http://localhost:${PORT}/chat -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" -d '{"protocol":1,"conversationId":"test","message":"Hello!"}'`);
});
