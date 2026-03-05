/**
 * Example: Express server with ChatCops
 *
 * Run:
 *   npm install express @chatcops/server
 *   ANTHROPIC_API_KEY=sk-... npx tsx express-server.ts
 */
import express from 'express';
import { chatcopsMiddleware } from '@chatcops/server';

const app = express();
app.use(express.json());

app.post('/chat', chatcopsMiddleware({
  provider: {
    type: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY!,
    model: 'claude-haiku-4-5-20251001',
  },
  systemPrompt: `You are a helpful customer support assistant for Acme Inc.
Be friendly, concise, and helpful. If a user wants to get in touch,
ask for their name, email, and project details to capture as a lead.`,
  cors: '*',
  rateLimit: { maxRequests: 30, windowMs: 60_000 },
  analytics: true,
}));

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`ChatCops server running on http://localhost:${PORT}`);
  console.log(`Test with: curl -X POST http://localhost:${PORT}/chat -H "Content-Type: application/json" -d '{"conversationId":"test","message":"Hello!"}'`);
});
