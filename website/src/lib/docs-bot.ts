import { FAQKnowledgeSource } from '@chatcops/core';

// The docs bot's instructions and FAQ, shared by the chat endpoint
// (src/pages/api/chat.ts) and its evals (chatcops.config.ts, evals/). Plain
// imports only: the evals load this file with Node, outside Astro.

export const docsBotSystemPrompt = `You are the ChatCops documentation assistant on the official ChatCops website.
Your job is to help developers understand and use ChatCops — an open-source AI chatbot widget.

Key facts:
- ChatCops has 3 packages: @chatcops/widget (client), @chatcops/server (backend), @chatcops/core (providers/tools)
- Widget is zero-dependency, Shadow DOM isolated, and works with a single script tag
- Server supports Express, Vercel, and Cloudflare Workers
- AI providers: Claude, OpenAI, Gemini
- MIT licensed, fully open-source at github.com/codercops/chatcops

Be concise, helpful, and friendly. Use markdown formatting. If you don't know something specific, direct users to the docs.
Answer greetings and small talk in one or two sentences, without listing everything you can help with.`;

export const docsBotFaq = new FAQKnowledgeSource([
  {
    question: 'What is ChatCops?',
    answer:
      'ChatCops is an open-source, universal AI chatbot widget you can embed on any website with a single script tag. It supports Claude, OpenAI, and Gemini as AI providers.',
  },
  {
    question: 'How do I install ChatCops?',
    answer:
      'The easiest way is via CDN: add a <script> tag with src="https://cdn.jsdelivr.net/npm/@chatcops/widget/dist/chatcops.min.js" and set data-api-url to your server endpoint. For npm: install @chatcops/widget, @chatcops/server, and optionally @chatcops/core.',
  },
  {
    question: 'What AI providers are supported?',
    answer:
      'ChatCops supports Claude (Anthropic), OpenAI, and Google Gemini. You configure the provider and model on the server side — the widget is provider-agnostic.',
  },
  {
    question: 'Is ChatCops free?',
    answer:
      'Yes! ChatCops is fully open-source under the MIT license. You only pay for your AI provider API usage (e.g., Anthropic, OpenAI, or Google).',
  },
  {
    question: 'What server platforms are supported?',
    answer:
      'ChatCops has adapters for Express.js, Vercel Serverless/Edge Functions, and Cloudflare Workers. You can also build custom integrations using the core package.',
  },
  {
    question: 'Can I customize the widget appearance?',
    answer:
      'The widget uses a dark theme by default. You can customize the accent color, text and background colors, font, border radius, and position through the theme configuration.',
  },
  {
    question: 'Does ChatCops support multiple languages?',
    answer:
      'The widget text is in English by default. To show it in another language, pass your translations in the widget\'s `strings` option. When the widget sends a `locale`, the server also asks the model to reply in that language.',
  },
  {
    question: 'How does the lead capture tool work?',
    answer:
      'The LeadCaptureTool lets the AI collect contact information (name, email, company, project details) during conversation. You provide a callback to handle the captured lead data.',
  },
]);
