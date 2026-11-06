/** Why a reply counts as not answering the question. */
export type UnansweredReason = 'refusal' | 'no_retrieval' | 'no_citation';

export interface AnswerCheck {
  /** The reply's text. */
  reply: string;
  /**
   * What retrieval found for this reply, when a knowledge source that
   * retrieves chunks ran. `minScore` only applies to `topScore` from the same
   * retriever, since scores aren't comparable across retrievers.
   */
  retrieval?: { chunks: number; topScore?: number; minScore?: number };
  /** How many pages the reply cited. */
  cited?: number;
  /** More phrases that mean "I don't know", matched case-insensitively. */
  phrases?: string[];
}

export interface AnswerVerdict {
  answered: boolean;
  reason?: UnansweredReason;
}

// The ways a reply says it doesn't know, in the languages the widget ships. A
// reply is checked near its start, where a refusal usually is, so a hedge late
// in a real answer doesn't count.
const REFUSALS = [
  "i don't know",
  'i do not know',
  "i'm not sure",
  'i am not sure',
  "i don't have information",
  "i don't have any information",
  'i do not have information',
  "i don't have details",
  "i couldn't find",
  'i could not find',
  "i can't find",
  "i'm unable to find",
  'no lo sé',
  'no tengo información',
  'no estoy seguro',
  'no estoy segura',
  'no encontré',
  'je ne sais pas',
  "je n'ai pas d'information",
  'je ne suis pas sûr',
  "je n'ai pas trouvé",
  'ich weiß nicht',
  'ich habe keine informationen',
  'ich bin mir nicht sicher',
  'não sei',
  'não tenho informações',
  'não tenho certeza',
  'não encontrei',
];
const REFUSAL_WINDOW = 300;
const MIN_WORDS_FOR_CITATION = 20;

/**
 * Whether a reply answered the visitor's question, from free signals only
 * (F-11): the reply says it doesn't know, retrieval found nothing, or
 * retrieval found pages the reply didn't cite. It's a heuristic for an answer
 * rate and a list of questions to fix, not a judgement of quality.
 */
export function checkAnswered(input: AnswerCheck): AnswerVerdict {
  const start = input.reply.slice(0, REFUSAL_WINDOW).toLowerCase().replace(/[‘’]/g, "'");
  const phrases = [...REFUSALS, ...(input.phrases ?? []).map((phrase) => phrase.toLowerCase())];
  if (phrases.some((phrase) => phrase && start.includes(phrase))) return { answered: false, reason: 'refusal' };

  const retrieval = input.retrieval;
  if (retrieval) {
    const tooWeak =
      retrieval.minScore !== undefined && retrieval.topScore !== undefined && retrieval.topScore < retrieval.minScore;
    if (retrieval.chunks === 0 || tooWeak) return { answered: false, reason: 'no_retrieval' };
    const words = input.reply.trim().split(/\s+/).filter(Boolean).length;
    if ((input.cited ?? 0) === 0 && words > MIN_WORDS_FOR_CITATION) return { answered: false, reason: 'no_citation' };
  }
  return { answered: true };
}
