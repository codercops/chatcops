import { describe, expect, it, vi } from 'vitest';
import { createProvider, registerProvider, type AIProvider, type ProviderConfig } from '../../src/index.js';

function custom(name: string): AIProvider {
  return {
    name,
    async *chat() { yield name; },
    async chatSync() { return name; },
  };
}

describe('provider registry', () => {
  it('passes the complete config to an async custom factory without requiring a key', async () => {
    const provider = custom('custom-async');
    const factory = vi.fn(async () => provider);
    const config: ProviderConfig = { type: 'custom-async', model: 'local', headers: { 'X-Route': 'a' } };
    registerProvider(config.type, factory);

    expect(await createProvider(config)).toBe(provider);
    expect(factory).toHaveBeenCalledExactlyOnceWith(config);
    expect(await provider.chatSync({ messages: [], systemPrompt: '' })).toBe('custom-async');
  });

  it('replaces a custom factory on registration for hot reload', async () => {
    const first = custom('first');
    const second = custom('second');
    registerProvider('hot-reload', () => first);
    expect(await createProvider({ type: 'hot-reload' })).toBe(first);
    registerProvider('hot-reload', () => second);
    expect(await createProvider({ type: 'hot-reload' })).toBe(second);
  });

  it.each(['claude', 'openai', 'gemini', 'openai-compatible'])(
    'refuses the reserved built-in name %s without replacing it', async (type) => {
      const factory = vi.fn(() => custom('replacement'));
      expect(() => registerProvider(type, factory)).toThrow(`Cannot register reserved provider type: ${type}`);
      const provider = await createProvider({ type, apiKey: 'test-key', baseURL: 'http://localhost:11434/v1', model: 'test' });
      expect(provider.name).toBe(type);
      expect(factory).not.toHaveBeenCalled();
    }
  );

  it('preserves the unknown-type error, including names inherited by ordinary objects', async () => {
    for (const type of ['unregistered', 'toString', '__proto__']) {
      await expect(createProvider({ type })).rejects.toThrow(`Unknown provider type: ${type}`);
    }
  });

  it('propagates a custom setup error', async () => {
    registerProvider('failing-custom', async () => { throw new Error('Custom setup failed'); });
    await expect(createProvider({ type: 'failing-custom' })).rejects.toThrow('Custom setup failed');
  });
});
