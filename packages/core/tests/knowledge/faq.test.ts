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

  it('strips trailing punctuation so queries still match', async () => {
    const source = new FAQKnowledgeSource(pairs);
    const context = await source.getContext('Refunds?');

    expect(context).toContain('refund');
  });

  it('keeps the first-3 fallback for a punctuation-only query', async () => {
    const source = new FAQKnowledgeSource(pairs);
    const context = await source.getContext('???');

    expect(context).toContain('Frequently Asked Questions');
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

  it('matches a question in Japanese', async () => {
    const source = new FAQKnowledgeSource([
      { question: '返金はできますか？', answer: 'はい、30日間の返金保証があります。' },
      { question: '営業時間は何時ですか？', answer: '平日午前9時から午後6時まで営業しています。' },
    ]);
    const context = await source.getContext('返金について教えてください');

    expect(context).toContain('30日間の返金保証');
  });

  it('returns empty when Japanese query only matches particles', async () => {
    const source = new FAQKnowledgeSource([
      { question: '営業時間は何時ですか？', answer: '平日9時から18時です。' },
      { question: '配送にかかる日数は？', answer: '3日から5日です。' },
    ]);
    const context = await source.getContext('返金はできますか？');

    expect(context).toBe('');
  });
});
