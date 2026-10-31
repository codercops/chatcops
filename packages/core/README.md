# @chatcops/core

Core AI provider abstraction, tools, knowledge base, conversation management, analytics, and i18n for ChatCops.

## Install

```bash
npm install @chatcops/core
```

## Providers

Unified interface for Claude, OpenAI and Gemini. A provider takes one model step at a time; `runTurn` runs a whole reply on top of it, with tool calls, and streams its parts.

```typescript
import { createProvider, runTurn, toolRegistry } from '@chatcops/core';

const provider = await createProvider({
  type: 'claude',       // 'claude' | 'openai' | 'gemini'
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-haiku-5-5', // optional
});

const turn = runTurn({
  provider,
  messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: Date.now() }],
  systemPrompt: 'You are a helpful assistant.',
  tools: toolRegistry([]),
  conversationId: 'one-off',
});

// The parts as they stream, then the finished message
let next = await turn.next();
while (!next.done) {
  if (next.value.type === 'text-delta') process.stdout.write(next.value.delta);
  next = await turn.next();
}
const { message, status } = next.value;
console.log(status, message.content.length);
```

Most sites don't call this directly: `@chatcops/server` runs the turns for the widget.

Default models: `claude-haiku-5-5` (Claude), `gpt-5-mini` (OpenAI), `gemini-3.5-flash-lite` (Gemini).

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
