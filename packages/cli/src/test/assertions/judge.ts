import type { AssertionCheck } from '../types.js';

const DEFAULT_THRESHOLD = 0.7;

/**
 * `judge: "Confirms the demo without inventing a time."`, or
 * `judge: { rubric, threshold }`: a model grades the reply against the rubric
 * from 0 to 1, and it passes at `threshold` (default 0.7) or above.
 */
export const judge: AssertionCheck = async (value, turn, conversation, context) => {
  const { rubric, threshold } = readJudge(value);
  if (!context.judge) throw new Error('judge needs a judge model, and none is set up');
  if (turn.error) return { pass: false, reason: `the turn failed (${turn.error}), so there's nothing to grade` };
  const verdict = await context.judge.grade(rubric, conversation);
  return {
    pass: verdict.score >= threshold,
    score: verdict.score,
    reason: `judge scored ${verdict.score.toFixed(2)} (pass at ${threshold}): ${verdict.reason}`,
    ...(verdict.costUsd !== undefined ? { costUsd: verdict.costUsd } : {}),
  };
};

function readJudge(value: unknown): { rubric: string; threshold: number } {
  if (typeof value === 'string' && value.trim()) return { rubric: value, threshold: DEFAULT_THRESHOLD };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { rubric, threshold = DEFAULT_THRESHOLD, ...rest } = value as { rubric?: unknown; threshold?: unknown };
    const extra = Object.keys(rest);
    if (typeof rubric === 'string' && rubric.trim() && typeof threshold === 'number' && threshold >= 0 && threshold <= 1 && !extra.length) {
      return { rubric, threshold };
    }
  }
  throw new Error('judge takes a rubric, or { rubric, threshold } with a threshold from 0 to 1');
}
