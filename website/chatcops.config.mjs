// The docs bot, for `chatcops test` (see evals/). Same instructions and FAQ as
// the chat endpoint, from src/lib/docs-bot.ts. In CI the tests replay
// evals/__cassettes__, so no key is needed; `npm run evals:record` calls the
// APIs with the keys in the repo's .env and updates the recordings.
import { silentLogger } from '@chatcops/core';
import { docsBotFaq, docsBotSystemPrompt } from './src/lib/docs-bot.ts';

export default {
  server: {
    provider: { type: 'openai', apiKey: process.env.OPENAI_API_KEY ?? '' },
    systemPrompt: docsBotSystemPrompt,
    knowledge: [docsBotFaq],
    // The startup notes and refused-request warnings aren't what these tests check.
    logger: silentLogger(),
  },
};
