import { describe, expect, it } from 'vitest';
import { checkAnswered } from '../../src/analytics/unanswered.js';

const long = 'Our Team plan costs twenty dollars per seat each month and includes shared inboxes, priority support, usage reports and single sign-on for every member.';

describe('checkAnswered', () => {
  it('counts a plain reply as answered when no knowledge ran', () => {
    expect(checkAnswered({ reply: 'Hi! How can I help?' })).toEqual({ answered: true });
  });

  it.each([
    "I don't know the answer to that.",
    'I’m not sure, but you could ask support.',
    "Sorry, I couldn't find anything about refunds.",
    'No tengo información sobre eso.',
    "Je n'ai pas d'information à ce sujet.",
    'Ich bin mir nicht sicher.',
    'Não encontrei nada sobre isso.',
  ])('flags a refusal: %s', (reply) => {
    expect(checkAnswered({ reply })).toEqual({ answered: false, reason: 'refusal' });
  });

  it('looks for a refusal near the start only, not a hedge late in a real answer', () => {
    const reply = `${long.repeat(3)} Beyond that I don't know of other plans.`;
    expect(checkAnswered({ reply })).toEqual({ answered: true });
  });

  it('takes extra phrases, in any case', () => {
    expect(checkAnswered({ reply: 'That is outside what I cover.', phrases: ['OUTSIDE WHAT I COVER'] })).toEqual({ answered: false, reason: 'refusal' });
    expect(checkAnswered({ reply: 'Fine.', phrases: [''] })).toEqual({ answered: true });
  });

  it('flags a reply when retrieval found nothing', () => {
    expect(checkAnswered({ reply: 'Here is what I know.', retrieval: { chunks: 0 } })).toEqual({ answered: false, reason: 'no_retrieval' });
  });

  it('flags a reply when the best chunk scores under minScore', () => {
    expect(checkAnswered({ reply: 'Yes.', retrieval: { chunks: 3, topScore: 0.2, minScore: 0.5 }, cited: 1 })).toEqual({ answered: false, reason: 'no_retrieval' });
    expect(checkAnswered({ reply: 'Yes.', retrieval: { chunks: 3, topScore: 0.7, minScore: 0.5 }, cited: 1 })).toEqual({ answered: true });
  });

  it('flags a long reply that cites none of the pages retrieval found', () => {
    expect(checkAnswered({ reply: long, retrieval: { chunks: 2 }, cited: 0 })).toEqual({ answered: false, reason: 'no_citation' });
  });

  it('accepts a long reply that cites, and a short one that does not', () => {
    expect(checkAnswered({ reply: long, retrieval: { chunks: 2 }, cited: 1 })).toEqual({ answered: true });
    expect(checkAnswered({ reply: 'You are welcome!', retrieval: { chunks: 2 } })).toEqual({ answered: true });
  });
});
