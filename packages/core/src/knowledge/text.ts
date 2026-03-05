import type { KnowledgeSource } from './base.js';

export class TextKnowledgeSource implements KnowledgeSource {
  type = 'text';
  private chunks: string[];

  constructor(chunks: string[]) {
    this.chunks = chunks;
  }

  async getContext(query: string): Promise<string> {
    const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (queryWords.length === 0) return '';

    const scored = this.chunks.map((chunk) => {
      const lower = chunk.toLowerCase();
      const score = queryWords.reduce((sum, word) => {
        const matches = lower.split(word).length - 1;
        return sum + matches;
      }, 0);
      return { chunk, score };
    });

    const relevant = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    if (relevant.length === 0) return '';

    return 'Relevant context:\n' + relevant.map((r) => r.chunk).join('\n\n');
  }
}
