import type { KnowledgeSource } from './base.js';

export interface FAQPair {
  question: string;
  answer: string;
}

export class FAQKnowledgeSource implements KnowledgeSource {
  type = 'faq';
  private pairs: FAQPair[];

  constructor(pairs: FAQPair[]) {
    this.pairs = pairs;
  }

  async getContext(query: string): Promise<string> {
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (queryWords.length === 0 && this.pairs.length > 0) {
      return this.formatPairs(this.pairs.slice(0, 3));
    }

    const scored = this.pairs.map((pair) => {
      const text = (pair.question + ' ' + pair.answer).toLowerCase();
      const score = queryWords.reduce((sum, word) => {
        const matches = text.split(word).length - 1;
        return sum + matches;
      }, 0);
      return { pair, score };
    });

    const relevant = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (relevant.length === 0) return '';

    return this.formatPairs(relevant.map((r) => r.pair));
  }

  private formatPairs(pairs: FAQPair[]): string {
    return 'Frequently Asked Questions:\n' +
      pairs.map((p) => `Q: ${p.question}\nA: ${p.answer}`).join('\n\n');
  }
}
