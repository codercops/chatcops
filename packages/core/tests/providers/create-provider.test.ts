import { describe, expect, it } from 'vitest';
import { createProvider } from '../../src/index.js';
import { ClaudeProvider } from '../../src/providers/claude.js';
import { GeminiProvider } from '../../src/providers/gemini.js';
import { OpenAIProvider } from '../../src/providers/openai.js';

describe('createProvider', () => {
  it('builds the provider class for each type', async () => {
    expect(await createProvider({ type: 'claude', apiKey: 'k' })).toBeInstanceOf(ClaudeProvider);
    expect(await createProvider({ type: 'openai', apiKey: 'k' })).toBeInstanceOf(OpenAIProvider);
    expect(await createProvider({ type: 'gemini', apiKey: 'k' })).toBeInstanceOf(GeminiProvider);
  });

  it('rejects an unknown type', async () => {
    await expect(createProvider({ type: 'nope' } as never)).rejects.toThrow('Unknown provider type: nope');
  });
});
