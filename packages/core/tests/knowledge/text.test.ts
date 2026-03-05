import { describe, it, expect } from 'vitest';
import { TextKnowledgeSource } from '../../src/knowledge/text.js';

describe('TextKnowledgeSource', () => {
  const chunks = [
    'Our pricing starts at $99/month for the basic plan.',
    'We offer 24/7 support via email and chat.',
    'The enterprise plan includes custom integrations and dedicated support.',
    'Free trial is available for 14 days, no credit card required.',
  ];

  it('returns relevant context for matching query', async () => {
    const source = new TextKnowledgeSource(chunks);
    const context = await source.getContext('What is the pricing?');

    expect(context).toContain('Relevant context:');
    expect(context).toContain('pricing');
  });

  it('returns empty for non-matching query', async () => {
    const source = new TextKnowledgeSource(chunks);
    const context = await source.getContext('xyz');

    expect(context).toBe('');
  });

  it('returns empty for very short query', async () => {
    const source = new TextKnowledgeSource(chunks);
    const context = await source.getContext('hi');

    expect(context).toBe('');
  });

  it('ranks results by relevance', async () => {
    const source = new TextKnowledgeSource(chunks);
    const context = await source.getContext('support email chat');

    expect(context).toContain('support');
  });

  it('limits to 3 results', async () => {
    const manyChunks = Array.from({ length: 10 }, (_, i) => `keyword content chunk ${i}`);
    const source = new TextKnowledgeSource(manyChunks);
    const context = await source.getContext('keyword content');

    const lines = context.split('\n\n');
    // Header + up to 3 chunks
    expect(lines.length).toBeLessThanOrEqual(4);
  });
});
