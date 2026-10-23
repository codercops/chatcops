import type { ProviderConfig } from '../types.js';
import type { AIProvider } from './types.js';

export type ProviderFactory = (config: ProviderConfig) => AIProvider | Promise<AIProvider>;

const builtins = new Set(['claude', 'openai', 'gemini', 'openai-compatible']);
const factories = new Map<string, ProviderFactory>();

/** Register a custom provider. Re-registering replaces its factory for hot reload. */
export function registerProvider(type: string, factory: ProviderFactory): void {
  if (builtins.has(type)) throw new Error(`Cannot register reserved provider type: ${type}`);
  factories.set(type, factory);
}

export function getProviderFactory(type: string): ProviderFactory | undefined {
  return factories.get(type);
}
