import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const tabs = [
  {
    id: 'express',
    label: 'Express',
    code: `import express from 'express';
import { chatcopsMiddleware } from '@chatcops/server';

const app = express();
app.use(express.json());

app.post('/chat', chatcopsMiddleware({
  provider: {
    type: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-4-5-20251001',
  },
  systemPrompt: 'You are a helpful assistant.',
  cors: '*',
  rateLimit: { maxRequests: 30, windowMs: 60_000 },
}));

app.listen(3001);`,
  },
  {
    id: 'vercel',
    label: 'Vercel',
    code: `import { chatcopsVercelHandler } from '@chatcops/server';

export const config = { runtime: 'edge' };

export default chatcopsVercelHandler({
  provider: {
    type: 'claude',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },
  systemPrompt: 'You are a helpful assistant.',
  cors: '*',
});`,
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare',
    code: `import { chatcopsCloudflareHandler } from '@chatcops/server';

export default {
  async fetch(request, env) {
    const handler = chatcopsCloudflareHandler({
      provider: {
        type: 'claude',
        apiKey: env.ANTHROPIC_API_KEY,
      },
      systemPrompt: 'You are a helpful assistant.',
      cors: '*',
    });

    return handler(request);
  },
};`,
  },
];

function highlight(code: string) {
  return code
    .replace(
      /\b(import|from|export|const|default|async|return)\b/g,
      '<span class="text-[#c084fc]">$1</span>'
    )
    .replace(
      /'([^']*)'/g,
      "'<span class=\"text-[#6ee7b7]\">$1</span>'"
    )
    .replace(
      /\b(chatcopsMiddleware|chatcopsVercelHandler|chatcopsCloudflareHandler|express|json|post|use|listen|fetch)\b(?=\()/g,
      '<span class="text-[#67e8f9]">$1</span>'
    )
    .replace(
      /\b(provider|type|apiKey|model|systemPrompt|cors|rateLimit|maxRequests|windowMs|runtime|config)\b(?=[\s]*:)/g,
      '<span class="text-[#fbbf24]">$1</span>'
    )
    .replace(
      /\b(\d[\d_]*)\b/g,
      '<span class="text-[#f472b6]">$1</span>'
    );
}

export default function CodeTabs() {
  const [active, setActive] = useState('express');
  const tab = tabs.find((t) => t.id === active)!;

  return (
    <div className="rounded-2xl border border-border bg-bg-surface overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`relative px-5 py-3 text-sm font-medium transition-colors ${
              active === t.id ? 'text-text' : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t.label}
            {active === t.id && (
              <motion.div
                layoutId="codeTab"
                className="absolute bottom-0 left-0 right-0 h-[2px] bg-primary"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Code */}
      <div className="relative min-h-[300px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="p-5"
          >
            <pre className="font-mono text-[13px] leading-[1.8] overflow-x-auto">
              <code dangerouslySetInnerHTML={{ __html: highlight(tab.code) }} />
            </pre>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
