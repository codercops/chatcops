import { batchSizeFor, checkedVectors, inBatches } from './http.js';
import type { Embedder } from './types.js';

export interface WorkersAiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface WorkersAiEmbedderOptions {
  /** The Cloudflare Workers AI binding (`env.AI`). */
  ai: WorkersAiBinding;
  /** Default `@cf/baai/bge-m3`. */
  model?: string;
  /** Vector length. Default 1024. */
  dimensions?: number;
  /** Max texts per `ai.run` call. Default 100, matching the model input limit. */
  batchSize?: number;
}

const DEFAULT_MODEL = '@cf/baai/bge-m3';
const DEFAULT_DIMENSIONS = 1024;
const DEFAULT_BATCH_SIZE = 100;

/**
 * Embeddings from Cloudflare Workers AI via binding (`env.AI`).
 * Calls `ai.run` in batches (default up to 100 texts), validating
 * response shape, vector count and dimensions.
 */
export function workersAiEmbedder(options: WorkersAiEmbedderOptions): Embedder {
  if (!options?.ai || typeof options.ai.run !== 'function') {
    throw new Error('workersAiEmbedder requires an ai binding with a run() method.');
  }

  const model = options.model ?? DEFAULT_MODEL;
  const dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
  const batchSize = batchSizeFor(options.batchSize, DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  const ai = options.ai;

  return {
    id: `workers-ai:${model}@${dimensions}`,
    dimensions,
    async embed(texts, _kind, embedOptions = {}) {
      if (embedOptions.signal?.aborted) {
        throw embedOptions.signal.reason;
      }
      return inBatches(texts, batchSize, async (batch) => {
        if (embedOptions.signal?.aborted) {
          throw embedOptions.signal.reason;
        }
        const response = await ai.run(model, { text: batch });
        if (!response || typeof response !== 'object' || !('data' in response) || !Array.isArray((response as { data?: unknown }).data)) {
          throw new Error(`Workers AI returned an invalid response for ${model}.`);
        }
        const data = (response as { data: unknown[] }).data;
        if (data.some((embedding) => !Array.isArray(embedding) && !(embedding instanceof Float32Array))) {
          throw new Error(`Workers AI returned an invalid embedding for ${model}.`);
        }
        return checkedVectors('Workers AI', model, data as unknown as number[][], batch.length, dimensions);
      });
    },
  };
}
