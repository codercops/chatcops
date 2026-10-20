import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from '../../src/providers/claude.js';
import { GeminiProvider } from '../../src/providers/gemini.js';
import { OpenAIProvider } from '../../src/providers/openai.js';

const params = { messages: [{ id: '1', role: 'user' as const, content: 'Hi', timestamp: 0 }], systemPrompt: 'Be brief.' };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

describe('the fetch option', () => {
  it('sends Claude requests through it', async () => {
    const fetch = vi.fn(async () => json({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Hello' }], usage: { input_tokens: 3, output_tokens: 1 },
    }));
    const claude = new ClaudeProvider({ type: 'claude', apiKey: 'test-key', fetch });
    await expect(claude.chatSync(params)).resolves.toBe('Hello');
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/v1\/messages$/);
  });

  it('sends OpenAI requests through it', async () => {
    const fetch = vi.fn(async () => json({ choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }] }));
    const openai = new OpenAIProvider({ type: 'openai', apiKey: 'test-key', fetch });
    await expect(openai.chatSync(params)).resolves.toBe('Hello');
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/chat\/completions$/);
  });

  it('sends Gemini requests through it', async () => {
    const fetch = vi.fn(async () => json({ candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }] }));
    const gemini = new GeminiProvider({ type: 'gemini', apiKey: 'test-key', fetch });
    await expect(gemini.chatSync(params)).resolves.toBe('Hello');
    expect(String(fetch.mock.calls[0][0])).toMatch(/generateContent/);
  });
});
