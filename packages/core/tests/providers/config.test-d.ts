import { describe, expectTypeOf, it } from 'vitest';
import type { AIProvider, ProviderConfig, ProviderFactory } from '../../src/index.js';
import { registerProvider } from '../../src/index.js';

describe('provider configuration types', () => {
  it('accepts built-in and custom names without requiring an API key', () => {
    expectTypeOf<{ type: 'openai-compatible'; baseURL: string; model: string }>().toExtend<ProviderConfig>();
    expectTypeOf<{ type: 'custom-model' }>().toExtend<ProviderConfig>();
    expectTypeOf<ProviderConfig['type']>().toEqualTypeOf<
      'claude' | 'openai' | 'gemini' | 'openai-compatible' | (string & {})
    >();
    expectTypeOf<ProviderConfig['apiKey']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ProviderConfig['headers']>().toEqualTypeOf<Record<string, string> | undefined>();
    expectTypeOf<ProviderConfig['supportsTools']>().toEqualTypeOf<boolean | undefined>();
  });

  it('exports a registry for synchronous or asynchronous factories', () => {
    expectTypeOf<ProviderFactory>().toEqualTypeOf<(config: ProviderConfig) => AIProvider | Promise<AIProvider>>();
    expectTypeOf(registerProvider).toEqualTypeOf<(type: string, factory: ProviderFactory) => void>();
  });
});
