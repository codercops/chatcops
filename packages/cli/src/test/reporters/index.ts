import type { TestResult } from '../types.js';
import { jsonReporter } from './json.js';
import { prettyReporter } from './pretty.js';

/** Where a reporter writes: stdout, unless the reporter is given a file. */
export interface ReporterOutput {
  write(text: string): unknown;
}

/** Gets results as tests finish, and all of them at the end. */
export interface Reporter {
  onResult?(result: TestResult): void;
  onEnd?(results: TestResult[]): void | Promise<void>;
}

export type ReporterFactory = (output: ReporterOutput) => Reporter;

/**
 * The reporters `--reporter` can name. To add one, write it in its own file
 * in this folder and add it here.
 */
export const REPORTERS = new Map<string, ReporterFactory>([
  ['pretty', prettyReporter],
  ['json', jsonReporter],
]);
