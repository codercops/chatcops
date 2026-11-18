import { describe, expect, it, vi } from 'vitest';
import { memoryVectors, workersAiEmbedder } from '../../src/index.js';

function makeVector(seed: number, dimensions = 1024): number[] {
  const v = new Array<number>(dimensions).fill(0);
  v[0] = seed;
  return v;
}

describe('workersAiEmbedder', () => {
  it('defaults to @cf/baai/bge-m3 and 1024 dimensions with the workers-ai provider id', () => {
    const ai = { run: vi.fn(async () => ({ data: [] })) };
    const embedder = workersAiEmbedder({ ai });

    expect(embedder.id).toBe('workers-ai:@cf/baai/bge-m3@1024');
    expect(embedder.dimensions).toBe(1024);
  });

  it('supports custom model and dimensions in id and vector length checks', async () => {
    const ai = {
      run: vi.fn(async (_model: string, input: unknown) => {
        const texts = (input as { text: string[] }).text;
        return { data: texts.map((_, i) => makeVector(i + 1, 768)) };
      }),
    };
    const embedder = workersAiEmbedder({
      ai,
      model: '@cf/baai/bge-base-en-v1.5',
      dimensions: 768,
    });

    expect(embedder.id).toBe('workers-ai:@cf/baai/bge-base-en-v1.5@768');
    expect(embedder.dimensions).toBe(768);

    const [vector] = await embedder.embed(['hello'], 'query');
    expect(vector.length).toBe(768);
    expect(vector).toBeInstanceOf(Float32Array);
    expect(vector[0]).toBe(1);
    expect(ai.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', { text: ['hello'] });
  });

  it('throws when ai binding is missing or does not have a run method', () => {
    expect(() => workersAiEmbedder({} as unknown as { ai: { run: () => Promise<unknown> } })).toThrow(
      'requires an ai binding with a run() method'
    );
  });

  it('makes no calls to ai.run when given empty texts array', async () => {
    const ai = { run: vi.fn() };
    const embedder = workersAiEmbedder({ ai });

    const vectors = await embedder.embed([], 'document');
    expect(vectors).toEqual([]);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('batches requests respecting the documented 100 limit and preserves order across batches', async () => {
    const ai = {
      run: vi.fn(async (_model: string, input: unknown) => {
        const texts = (input as { text: string[] }).text;
        return { data: texts.map((t) => makeVector(Number(t))) };
      }),
    };
    const embedder = workersAiEmbedder({ ai });

    const texts = Array.from({ length: 150 }, (_, i) => String(i + 1));
    const vectors = await embedder.embed(texts, 'document');

    expect(ai.run).toHaveBeenCalledTimes(2);
    expect(ai.run).toHaveBeenNthCalledWith(1, '@cf/baai/bge-m3', { text: texts.slice(0, 100) });
    expect(ai.run).toHaveBeenNthCalledWith(2, '@cf/baai/bge-m3', { text: texts.slice(100, 150) });

    expect(vectors).toHaveLength(150);
    expect(vectors.map((v) => v[0])).toEqual(texts.map(Number));
    expect(vectors[0]).toBeInstanceOf(Float32Array);
  });

  it('supports custom batchSize and preserves order', async () => {
    const ai = {
      run: vi.fn(async (_model: string, input: unknown) => {
        const texts = (input as { text: string[] }).text;
        return { data: texts.map((t) => makeVector(Number(t), 4)) };
      }),
    };
    const embedder = workersAiEmbedder({ ai, dimensions: 4, batchSize: 2 });

    const vectors = await embedder.embed(['1', '2', '3', '4', '5'], 'document');

    expect(ai.run).toHaveBeenCalledTimes(3);
    expect(ai.run).toHaveBeenNthCalledWith(1, '@cf/baai/bge-m3', { text: ['1', '2'] });
    expect(ai.run).toHaveBeenNthCalledWith(2, '@cf/baai/bge-m3', { text: ['3', '4'] });
    expect(ai.run).toHaveBeenNthCalledWith(3, '@cf/baai/bge-m3', { text: ['5'] });

    expect(vectors.map((v) => v[0])).toEqual([1, 2, 3, 4, 5]);
  });

  it('works with memoryVectors vector store', async () => {
    const ai = {
      run: vi.fn(async (_model: string, input: unknown) => {
        const texts = (input as { text: string[] }).text;
        return {
          data: texts.map((text) =>
            text.includes('refund') ? makeVector(1, 8) : makeVector(0.1, 8)
          ),
        };
      }),
    };
    const embedder = workersAiEmbedder({ ai, dimensions: 8 });
    const docs = await embedder.embed(['We offer full refunds.', 'Our office is open weekdays.'], 'document');
    const [query] = await embedder.embed(['How do I get a refund?'], 'query');

    const store = memoryVectors({ dimensions: 8 });
    await store.upsert(
      docs.map((vector, i) => ({ id: `d${i}`, vector, text: `doc ${i}`, source: { id: 's', url: 'https://example.test' } }))
    );

    const [best] = await store.query({ vector: query, topK: 1 });
    expect(best.id).toBe('d0');
  });

  it('fails clearly when response is malformed', async () => {
    const nullResponse = workersAiEmbedder({ ai: { run: vi.fn().mockResolvedValue(null) } });
    await expect(nullResponse.embed(['x'], 'query')).rejects.toThrow(
      'Workers AI returned an invalid response for @cf/baai/bge-m3.'
    );

    const primitiveResponse = workersAiEmbedder({ ai: { run: vi.fn().mockResolvedValue('not an object') } });
    await expect(primitiveResponse.embed(['x'], 'query')).rejects.toThrow(
      'Workers AI returned an invalid response for @cf/baai/bge-m3.'
    );

    const missingData = workersAiEmbedder({ ai: { run: vi.fn().mockResolvedValue({}) } });
    await expect(missingData.embed(['x'], 'query')).rejects.toThrow(
      'Workers AI returned an invalid response for @cf/baai/bge-m3.'
    );

    const dataNotArray = workersAiEmbedder({ ai: { run: vi.fn().mockResolvedValue({ data: 'string' }) } });
    await expect(dataNotArray.embed(['x'], 'query')).rejects.toThrow(
      'Workers AI returned an invalid response for @cf/baai/bge-m3.'
    );

    const invalidEmbedding = workersAiEmbedder({ ai: { run: vi.fn().mockResolvedValue({ data: ['not an array'] }) } });
    await expect(invalidEmbedding.embed(['x'], 'query')).rejects.toThrow(
      'Workers AI returned an invalid embedding for @cf/baai/bge-m3.'
    );
  });

  it('fails clearly on vector count mismatch', async () => {
    const wrongCount = workersAiEmbedder({
      ai: { run: vi.fn().mockResolvedValue({ data: [makeVector(1)] }) },
    });
    await expect(wrongCount.embed(['x', 'y'], 'query')).rejects.toThrow(
      'Workers AI returned 1 embeddings for 2 texts.'
    );
  });

  it('fails clearly on dimension mismatch', async () => {
    const wrongDimensions = workersAiEmbedder({
      dimensions: 1024,
      ai: { run: vi.fn().mockResolvedValue({ data: [makeVector(1, 512)] }) },
    });
    await expect(wrongDimensions.embed(['x'], 'query')).rejects.toThrow(
      'Workers AI returned 512 dimensions from @cf/baai/bge-m3, but the embedder is set to 1024.'
    );
  });

  it('preserves the original error message when the binding throws and does not retry', async () => {
    const bindingError = new Error('Workers AI model overloaded (code 10015)');
    const ai = { run: vi.fn().mockRejectedValue(bindingError) };
    const embedder = workersAiEmbedder({ ai });

    await expect(embedder.embed(['x'], 'query')).rejects.toThrow('Workers AI model overloaded (code 10015)');
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it('stops and rejects with signal reason when aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Turn canceled'));

    const ai = { run: vi.fn() };
    const embedder = workersAiEmbedder({ ai });

    await expect(embedder.embed(['x'], 'query', { signal: controller.signal })).rejects.toThrow('Turn canceled');
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('stops and rejects with signal reason when aborted between batches', async () => {
    const controller = new AbortController();
    const ai = {
      run: vi.fn().mockImplementation(async () => {
        controller.abort(new Error('Turn canceled mid-batch'));
        return { data: [makeVector(1)] };
      }),
    };
    const embedder = workersAiEmbedder({ ai, batchSize: 1 });

    await expect(embedder.embed(['x', 'y'], 'query', { signal: controller.signal })).rejects.toThrow(
      'Turn canceled mid-batch'
    );
    expect(ai.run).toHaveBeenCalledTimes(1);
  });
});
