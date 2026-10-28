import { runStorageConformance } from '@chatcops/core/testing';
import { memoryStorage } from '@chatcops/core';
import { Index } from '@upstash/vector';
import { describe } from 'vitest';
import { upstashVectors } from '../src/index.js';

const url = process.env.CHATCOPS_TEST_UPSTASH_VECTOR_URL;
const token = process.env.CHATCOPS_TEST_UPSTASH_VECTOR_TOKEN;

if (url && token) {
  runStorageConformance('@upstash/vector', () => {
    const index = new Index({ url, token });
    return { ...memoryStorage(), vectors: upstashVectors({ index, dimensions: 4 }) };
  });
} else {
  describe.skip('@upstash/vector conformance (set CHATCOPS_TEST_UPSTASH_VECTOR_URL and CHATCOPS_TEST_UPSTASH_VECTOR_TOKEN to run)', () => {});
}
