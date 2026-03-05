import { describe, it, expect } from 'vitest';
import { FAQKnowledgeSource } from '../../src/knowledge/faq.js';

describe('FAQKnowledgeSource', () => {
  const pairs = [
    { question: 'What are your business hours?', answer: 'We are open Monday to Friday, 9am to 6pm.' },
    { question: 'Do you offer refunds?', answer: 'Yes, we offer a 30-day money-back guarantee.' },
    { question: 'How do I contact support?', answer: 'Email us at support@example.com or use the chat.' },
  ];

  it('returns matching FAQ pairs', async () => {
    const source = new FAQKnowledgeSource(pairs);
    const context = await source.getContext('refund policy');

    expect(context).toContain('Frequently Asked Questions');
    expect(context).toContain('refund');
  });

  it('returns first 3 pairs for empty-ish query', async () => {
    const source = new FAQKnowledgeSource(pairs);
    const context = await source.getContext('hi');

    expect(context).toContain('Frequently Asked Questions');
  });

  it('returns empty for non-matching long query', async () => {
    const source = new FAQKnowledgeSource(pairs);
    const context = await source.getContext('quantum physics explanation');

    expect(context).toBe('');
  });

  it('formats as Q&A pairs', async () => {
    const source = new FAQKnowledgeSource(pairs);
    const context = await source.getContext('support contact email');

    expect(context).toContain('Q:');
    expect(context).toContain('A:');
  });
});
