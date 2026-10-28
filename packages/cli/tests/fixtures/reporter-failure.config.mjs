import { textStep } from '@chatcops/core/testing/provider';

const provider = {
  name: 'fake',
  model: 'fake-demo',
  async *step() {
    yield* textStep('This reply is deliberately missing the expected phrase.', {
      usage: { inputTokens: 8, outputTokens: 9 },
    });
  },
};

export default {
  server: {
    provider,
    systemPrompt: 'A deterministic reporter demonstration.',
  },
};
