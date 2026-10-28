import type { ReporterFactory } from './index.js';

/** One JSON object at the end: counts, and every run with every turn. */
export const jsonReporter: ReporterFactory = (output) => ({
  onEnd(results, summary) {
    const failed = results.filter((result) => !result.pass).length;
    output.write(`${JSON.stringify({ passed: results.length - failed, failed, summary, results })}\n`);
  },
});
