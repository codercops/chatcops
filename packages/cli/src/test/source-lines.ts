import type { TestCase, TestResult } from './types.js';

/** YAML source positions keyed by the loaded test or its aggregate result. */
export const sourceLines = new WeakMap<TestCase | TestResult, number>();
