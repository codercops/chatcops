import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ChatCopsStorage, Embedder, KeyValueStore, VectorStore } from '@chatcops/core';
import type { IngestConfig } from '@chatcops/ingest';

/** `chatcops.config.ts`: what the commands index into and search. */
export interface ChatCopsCliConfig {
  /** The embedder the index is built and searched with. */
  embedder: Embedder;
  /** Storage with `vectors` and `kv` (the manifest), such as `postgresStorage(...)`. */
  storage?: ChatCopsStorage;
  /** Or the vector store and manifest separately. */
  store?: VectorStore;
  manifest?: KeyValueStore;
  /** What `chatcops ingest` reads, unless `--source` says otherwise. */
  ingest?: Omit<IngestConfig, 'embedder' | 'store' | 'manifest' | 'onEvent' | 'dryRun' | 'force' | 'prune'>;
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
  store: VectorStore;
  manifest: KeyValueStore;
  close(): Promise<void>;
}

/** The config at `path`, or the first `chatcops.config.*` in `cwd`, checked. */
export async function loadConfig(cwd: string, path?: string): Promise<LoadedConfig> {
  const file = path ? resolve(cwd, path) : CONFIG_FILES.map((name) => resolve(cwd, name)).find((candidate) => existsSync(candidate));
  if (!file || !existsSync(file)) {
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
  if (!config.embedder) throw new ConfigError(`${file} needs an \`embedder\`, such as openaiEmbedder({ apiKey }).`);
  const store = config.store ?? config.storage?.vectors;
  const manifest = config.manifest ?? config.storage?.kv;
  if (!store) throw new ConfigError(`${file} needs a vector store: \`storage\` with vectors, or \`store\`.`);
  if (!manifest) throw new ConfigError(`${file} needs a manifest: \`storage\` with a key-value store, or \`manifest\`.`);

  return { file, config, store, manifest, close: async () => void (await config.storage?.close?.()) };
}
