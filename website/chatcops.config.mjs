// The docs bot, for `chatcops test` (see evals/). Same instructions, docs
// index and FAQ as the chat endpoint, from src/lib/docs-bot.ts and
// src/lib/docs-index.ts. In CI the tests replay
// evals/__cassettes__, so no key is needed; `npm run evals:record` calls the
// APIs with the keys in the repo's .env and updates the recordings.
import { readFile } from 'node:fs/promises';
import { silentLogger } from '@chatcops/core';
import { docsBotFaq, docsBotSystemPrompt } from './src/lib/docs-bot.ts';
import { docsKnowledge } from './src/lib/docs-index.ts';

const readIndexFile = async (name) => {
  const file = await readFile(new URL(`./public/docs-index/${name}`, import.meta.url));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
};

export default {
  server: {
    provider: { type: 'openai', apiKey: process.env.OPENAI_API_KEY ?? '' },
    systemPrompt: docsBotSystemPrompt,
    knowledge: [docsKnowledge(readIndexFile, process.env.OPENAI_API_KEY ?? ''), docsBotFaq],
    // The startup notes and refused-request warnings aren't what these tests check.
    logger: silentLogger(),
  },
};
