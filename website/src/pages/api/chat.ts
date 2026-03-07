import type { APIRoute } from 'astro';
import { createChatHandler } from '@chatcops/server';
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
      'ChatCops supports Claude (Anthropic), OpenAI (GPT-4, GPT-3.5), and Google Gemini. You configure the provider on the server side — the widget is provider-agnostic.',
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
      'Absolutely. You can customize the accent color, text color, background, font, border radius, and position. The widget supports full theming and dark/light modes.',
  },
  {
    question: 'Does ChatCops support multiple languages?',
    answer:
      'Yes. ChatCops has built-in i18n support with translations for English, Spanish, French, German, Japanese, Chinese, Hindi, and Arabic. You can also provide custom strings.',
  },
  {
    question: 'How does the lead capture tool work?',
    answer:
      'The LeadCaptureTool lets the AI collect contact information (name, email, company, project details) during conversation. You provide a callback to handle the captured lead data.',
  },
]);

const { handleChat } = createChatHandler({
  provider: {
    type: 'openai',
    apiKey: import.meta.env.OPENAI_API_KEY ?? '',
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
  cors: '*',
  rateLimit: { maxRequests: 10, windowMs: 60_000 },
});

export const POST: APIRoute = async ({ request }) => {
  const clientIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of handleChat(body, clientIp)) {
          controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ error: 'internal_error' })}\n\n`
          )
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
};
