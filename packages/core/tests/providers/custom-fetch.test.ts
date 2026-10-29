import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '../../src/providers/claude.js';
import { GeminiProvider } from '../../src/providers/gemini.js';
import { OpenAIProvider } from '../../src/providers/openai.js';
import { replayFetch } from '../helpers/replay-fetch.js';
import { chatSyncViaTurn } from '../helpers/chat-via-turn.js';

const params = { messages: [{ id: '1', role: 'user' as const, content: 'Say hello in five words.', timestamp: 0 }], systemPrompt: 'Be brief.' };

function spyOn(provider: string) {
  const replay = replayFetch(provider, 'text');
  return vi.fn(replay.fetch);
}

describe('the fetch option', () => {
  it('sends Claude requests through it', async () => {
    const fetch = spyOn('claude');
    const text = await chatSyncViaTurn(new ClaudeProvider({ type: 'claude', apiKey: 'test-key', fetch }), params);
    expect(text.length).toBeGreaterThan(0);
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/v1\/messages$/);
  });

  it('sends OpenAI requests through it', async () => {
    const fetch = spyOn('openai');
    const text = await chatSyncViaTurn(new OpenAIProvider({ type: 'openai', apiKey: 'test-key', fetch }), params);
    expect(text.length).toBeGreaterThan(0);
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/chat\/completions$/);
  });

  it('sends Gemini requests through it', async () => {
    const fetch = spyOn('gemini');
    const text = await chatSyncViaTurn(new GeminiProvider({ type: 'gemini', apiKey: 'test-key', fetch }), params);
    expect(text.length).toBeGreaterThan(0);
    expect(String(fetch.mock.calls[0][0])).toMatch(/streamGenerateContent/);
  });
});
