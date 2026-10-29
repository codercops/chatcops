import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AIProvider, ChatCopsStorage, Embedder, KeyValueStore, ProviderConfig, VectorStore } from '@chatcops/core';
import type { IngestConfig } from '@chatcops/ingest';
import type { ChatCopsServerConfig } from '@chatcops/server';
import type { Prices } from './test/cost.js';

/** `chatcops.config.ts`: what the commands index into and search. */
export interface ChatCopsCliConfig {
  /** The embedder the index is built and searched with. Needed by `ingest` and `search`. */
  embedder?: Embedder;
  /** Storage with `vectors` and `kv` (the manifest), such as `postgresStorage(...)`. */
  storage?: ChatCopsStorage;
  /** Or the vector store and manifest separately. */
  store?: VectorStore;
  manifest?: KeyValueStore;
  /** What `chatcops ingest` reads, unless `--source` says otherwise. */
  ingest?: Omit<IngestConfig, 'embedder' | 'store' | 'manifest' | 'onEvent' | 'dryRun' | 'force' | 'prune'>;
  /**
   * The bot `chatcops test` talks to: the same config you give the server
   * (provider, system prompt, tools, knowledge). Each test gets its own
   * in-memory storage, so `storage` here is ignored.
   */
  server?: ChatCopsServerConfig;
  /**
   * The model that grades `judge` assertions. Defaults to the cheap model of
   * a provider other than the bot's, with its key from the environment.
   * `--judge-model` overrides it.
   */
  judge?: ProviderConfig | AIProvider;
  /** US dollars per million tokens, by model id, for costs and `--max-cost`. */
  prices?: Prices;
}

/** Types a config file: `export default defineConfig({ ... })`. */
export function defineConfig(config: ChatCopsCliConfig): ChatCopsCliConfig {
  return config;
}

export const CONFIG_FILES = ['chatcops.config.ts', 'chatcops.config.mts', 'chatcops.config.js', 'chatcops.config.mjs'];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface LoadedConfig {
  file: string;
  config: ChatCopsCliConfig;
  close(): Promise<void>;
}

export interface IndexConfig {
  embedder: Embedder;
  store: VectorStore;
  manifest: KeyValueStore;
}

/** What `ingest` and `search` need from the config, or a message saying what's missing. */
export function indexConfig({ file, config }: LoadedConfig): IndexConfig {
  if (!config.embedder) throw new ConfigError(`${file} needs an \`embedder\`, such as openaiEmbedder({ apiKey }).`);
  const store = config.store ?? config.storage?.vectors;
  const manifest = config.manifest ?? config.storage?.kv;
  if (!store) throw new ConfigError(`${file} needs a vector store: \`storage\` with vectors, or \`store\`.`);
  if (!manifest) throw new ConfigError(`${file} needs a manifest: \`storage\` with a key-value store, or \`manifest\`.`);
  return { embedder: config.embedder, store, manifest };
}

/** What `test` needs from the config. */
export function serverConfig({ file, config }: LoadedConfig): ChatCopsServerConfig {
  if (!config.server) throw new ConfigError(`${file} needs a \`server\` config for chatcops test: the provider, system prompt and tools of your bot.`);
  return config.server;
}

/** The config at `path`, or the first `chatcops.config.*` in `cwd`, checked. */
export async function loadConfig(cwd: string, path?: string): Promise<LoadedConfig> {
  return loadConfigInner(cwd, path, false);
}

/** URL-mode evals may use judge/prices from a config, but don't need one. */
export async function loadConfigForRemoteTest(cwd: string, path?: string): Promise<LoadedConfig> {
  return loadConfigInner(cwd, path, true);
}

async function loadConfigInner(cwd: string, path: string | undefined, optional: boolean): Promise<LoadedConfig> {
  const file = path ? resolve(cwd, path) : CONFIG_FILES.map((name) => resolve(cwd, name)).find((candidate) => existsSync(candidate));
  if (!file || !existsSync(file)) {
    if (optional && !path) return { file: cwd, config: {}, close: async () => {} };
    throw new ConfigError(
      path ? `No config file at ${file}.` : `No config file found. Create chatcops.config.ts (or .mjs) in ${cwd}, or pass --config.`
    );
  }

  let config: ChatCopsCliConfig | undefined;
  try {
    const module = (await import(pathToFileURL(file).href)) as { default?: ChatCopsCliConfig };
    config = module.default;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ERR_UNKNOWN_FILE_EXTENSION' && /\.m?ts$/.test(file)) {
      throw new ConfigError(`This Node.js can't load TypeScript config files. Use Node 22.18 or later, or rename ${file} to chatcops.config.mjs.`);
    }
    throw new ConfigError(`Couldn't load ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!config || typeof config !== 'object') throw new ConfigError(`${file} has no default export. Export the config with \`export default defineConfig({ ... })\`.`);
  return { file, config, close: async () => void (await config.storage?.close?.()) };
}
