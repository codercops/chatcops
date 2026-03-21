# @chatcops/core

Core AI provider abstraction, tools, knowledge base, conversation management, analytics, and i18n for ChatCops.

## Install

```bash
npm install @chatcops/core
```

## Providers

Unified interface for Claude, OpenAI, and Gemini. Supports streaming (AsyncGenerator) and sync modes.

```typescript
import { createProvider } from '@chatcops/core';

const provider = await createProvider({
  type: 'claude',       // 'claude' | 'openai' | 'gemini'
  apiKey: process.env.ANTHROPIC_API_KEY,
  model: 'claude-haiku-4-5-20251001', // optional
});

// Streaming
for await (const chunk of provider.chat({
  messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: Date.now() }],
  systemPrompt: 'You are a helpful assistant.',
})) {
  process.stdout.write(chunk);
}

// Sync
const response = await provider.chatSync({
  messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: Date.now() }],
  systemPrompt: 'You are a helpful assistant.',
});
```

Default models: `claude-haiku-4-5-20251001` (Claude), `gpt-4o-mini` (OpenAI), `gemini-2.0-flash` (Gemini).

## Tools

Define tools the AI can call. Built-in `LeadCaptureTool` for collecting contact info.

```typescript
import { LeadCaptureTool } from '@chatcops/core';

const leadTool = new LeadCaptureTool((lead) => {
  console.log('Lead captured:', lead.name, lead.email);
});
```

Custom tools implement the `ChatTool` interface:

```typescript
import type { ChatTool, ToolResult } from '@chatcops/core';

const myTool: ChatTool = {
  name: 'lookup_order',
  description: 'Look up an order by ID',
  parameters: {
    orderId: { type: 'string', description: 'The order ID' },
  },
  required: ['orderId'],
  async execute(input): Promise<ToolResult> {
    return { success: true, data: { status: 'shipped' } };
  },
};
```

## Knowledge Base

Feed context to the AI with text chunks or FAQ pairs.

```typescript
import { TextKnowledgeSource, FAQKnowledgeSource } from '@chatcops/core';

const text = new TextKnowledgeSource([
  'ChatCops supports Claude, OpenAI, and Gemini.',
  'The widget is zero-dependency and uses Shadow DOM.',
]);

const faq = new FAQKnowledgeSource([
  { question: 'What is ChatCops?', answer: 'An embeddable AI chat widget.' },
  { question: 'Is it free?', answer: 'Yes, MIT licensed.' },
]);

const context = await faq.getContext('is chatcops free');
```

## Conversation Management

```typescript
import { ConversationManager } from '@chatcops/core';

const manager = new ConversationManager({ maxMessages: 100 });
const conversation = await manager.getOrCreate('conv-123');
await manager.addMessage('conv-123', {
  id: '1', role: 'user', content: 'Hello', timestamp: Date.now(),
});
```

Plug in your own store by implementing `ConversationStore`.

## Analytics

```typescript
import { AnalyticsCollector } from '@chatcops/core';

const analytics = new AnalyticsCollector();
analytics.track('message:sent', { conversationId: 'conv-123' });
const stats = analytics.getStats();
```

## i18n

8 built-in locales: `en`, `es`, `hi`, `fr`, `de`, `ja`, `zh`, `ar`.

```typescript
import { getLocale, getAvailableLocales } from '@chatcops/core';

const strings = getLocale('es');
console.log(strings.welcomeMessage); // "Hola! Como puedo ayudarte hoy?"
console.log(getAvailableLocales());  // ['en', 'es', 'hi', 'fr', 'de', 'ja', 'zh', 'ar']
```

## License

MIT
