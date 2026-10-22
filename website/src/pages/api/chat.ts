import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import { chatcopsCloudflareHandler } from '@chatcops/server/cloudflare';
import { FAQKnowledgeSource } from '@chatcops/core';

export const prerender = false;

const faq = new FAQKnowledgeSource([
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

// Built on the first request rather than at import: the API key is a Worker
// secret that only exists inside a request, and the handler starts a
// timer, which Workers don't allow at global scope.
let chat: ReturnType<typeof chatcopsCloudflareHandler> | undefined;
function getChat() {
  chat ??= chatcopsCloudflareHandler({
    provider: {
      type: 'openai',
      apiKey: getSecret('OPENAI_API_KEY') ?? '',
    },
    systemPrompt: `You are the ChatCops documentation assistant on the official ChatCops website.
Your job is to help developers understand and use ChatCops — an open-source AI chatbot widget.

Key facts:
- ChatCops has 3 packages: @chatcops/widget (client), @chatcops/server (backend), @chatcops/core (providers/tools)
- Widget is zero-dependency, Shadow DOM isolated, and works with a single script tag
- Server supports Express, Vercel, and Cloudflare Workers
- AI providers: Claude, OpenAI, Gemini
- MIT licensed, fully open-source at github.com/codercops/chatcops

Be concise, helpful, and friendly. Use markdown formatting. If you don't know something specific, direct users to the docs.`,
    knowledge: [faq],
    allowedOrigins: [
      'https://chat.codercops.com',
      ...(import.meta.env.DEV ? ['http://localhost:4321'] : []),
    ],
    // Cloudflare sets this header. Only local dev trusts the forwarded fallback.
    clientIp: (request) =>
      request.headers.get('cf-connecting-ip') ??
      (import.meta.env.DEV ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() : undefined),
    rateLimit: { maxRequests: 10, windowMs: 60_000 },
  });
  return chat;
}

export const POST: APIRoute = ({ request, locals }) => getChat()(request, undefined, locals.cfContext);

export const OPTIONS: APIRoute = ({ request, locals }) => getChat()(request, undefined, locals.cfContext);
