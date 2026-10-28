# @chatcops/store-upstash-vector

Upstash Vector storage for ChatCops embedded page chunks.

## Install

```bash
npm install @chatcops/store-upstash-vector @upstash/vector
```

`@upstash/vector` is a peer dependency. Create a dense Upstash Vector index with the same dimension count as the embedder (at least 4 dimensions for the ChatCops conformance suite). Configure the index distance metric for cosine similarity. Upstash credentials are available from the index settings.

```ts
import { Index } from '@upstash/vector';
import { upstashVectors } from '@chatcops/store-upstash-vector';

const dimensions = 1024;
const index = new Index({
  url: process.env.UPSTASH_VECTOR_REST_URL!,
  token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
});
const vectors = upstashVectors({ index, dimensions });

await vectors.upsert([{
  id: 'pricing-0',
  vector: new Float32Array(dimensions),
  text: 'The Team plan is $20 a month.',
  source: { id: 'pricing', url: 'https://example.com/pricing', title: 'Pricing' },
  metadata: { locale: 'en' },
}]);

const results = await vectors.query({
  vector: new Float32Array(dimensions),
  topK: 5,
  filter: { locale: ['en', 'de'] },
});
```

Each filter key is ANDed with the other keys; arrays accept any listed value. Strings, numbers and booleans are serialized separately. Filter keys must be simple Upstash identifiers made of letters, digits, underscores, or hyphens (starting with a letter or underscore); nested path keys and keys containing punctuation that Upstash reserves for path syntax are rejected. String values are single-quoted with embedded quotes and backslashes escaped. The store reserves `__chatcops_source_*` metadata keys to preserve source fields and support `deleteBySource`.

For a sparse index or a hybrid index with a sparse text embedding model, enable keyword search explicitly with `upstashVectors({ index, dimensions, keywordSearch: true })`. The option adds `keywordQuery`, which tokenizes queries with `segmentWords` and sends them to Upstash in sparse mode. Dense indexes leave the method absent. The SDK's `Index` type does not encode the configured index kind, so enable this option only for supported sparse or hybrid indexes. For dense cosine indexes, Upstash reports `(1 + cosine similarity) / 2`; this adapter converts that value back to ChatCops' cosine score range of `[-1, 1]`.

To expose the store through `ChatCopsStorage`, assign it to `vectors`:

```ts
import { memoryStorage } from '@chatcops/core';

const storage = { ...memoryStorage(), vectors: upstashVectors({ index, dimensions }) };
```

Here `memoryStorage` is imported from `@chatcops/core` when you want its other in-memory capabilities alongside the Upstash vector index.

## Testing

Run `pnpm --filter @chatcops/store-upstash-vector test`. Unit tests use a fake Index. To run conformance against a dedicated test index, create a cosine dense index with at least 4 dimensions, set `CHATCOPS_TEST_UPSTASH_VECTOR_URL` and `CHATCOPS_TEST_UPSTASH_VECTOR_TOKEN`, then run the test command. Tests tag their records with unique run IDs and do not reset or clear the index. The test index should be reserved for conformance runs.
