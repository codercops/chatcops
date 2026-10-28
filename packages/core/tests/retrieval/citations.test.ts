import { describe, expect, it } from 'vitest';
import { CitationParser, parseCitations, sourcePart, type RetrievedChunk } from '../../src/index.js';

const chunk = (id: string, text = `Text ${id}`, title?: string): RetrievedChunk => ({
  id,
  text,
  score: 1,
  source: { id: `page-${id}`, url: `https://example.test/${id}`, ...(title ? { title } : {}) },
});

describe('parseCitations', () => {
  it('keeps markers for real sources and reports each once, by 0-based index', () => {
    expect(parseCitations('Plans start at $20 [2]. Refunds take 14 days [1][2].', 3)).toEqual({
      text: 'Plans start at $20 [2]. Refunds take 14 days [1][2].',
      cited: [1, 0],
    });
  });

  it('drops numbers that match no source, and [0]', () => {
    expect(parseCitations('Yes [7]. Also [0] and [3].', 3)).toEqual({ text: 'Yes . Also  and [3].', cited: [2] });
  });

  it('leaves brackets that are not markers alone', () => {
    const text = 'Use [Settings] > [Billing], arrays like a[i], [1a], [ 1 ], [1000] and a lone [';
    expect(parseCitations(text, 3)).toEqual({ text, cited: [] });
  });
});

describe('CitationParser', () => {
  const text = 'The Team plan is $20 [1]. Enterprise is custom [3][2], not [9]. See [docs] too [2]. Done [';

  it('gives the same text and citations for every way the text can be split into two deltas', () => {
    const whole = parseCitations(text, 3);
    for (let cut = 0; cut <= text.length; cut++) {
      const parser = new CitationParser(3);
      const a = parser.push(text.slice(0, cut));
      const b = parser.push(text.slice(cut));
      const c = parser.flush();
      expect({ text: a.text + b.text + c.text, cited: [...a.cited, ...b.cited, ...c.cited] }, `cut at ${cut}`).toEqual(whole);
    }
  });

  it('gives the same result one character at a time', () => {
    const parser = new CitationParser(3);
    let out = '';
    const cited: number[] = [];
    for (const char of text) {
      const read = parser.push(char);
      out += read.text;
      cited.push(...read.cited);
    }
    const rest = parser.flush();
    expect({ text: out + rest.text, cited: [...cited, ...rest.cited] }).toEqual(parseCitations(text, 3));
  });

  it('holds back a marker that is still arriving, and no more than that', () => {
    const parser = new CitationParser(2);
    expect(parser.push('Refunds take 14 days [')).toEqual({ text: 'Refunds take 14 days ', cited: [] });
    expect(parser.push('1')).toEqual({ text: '', cited: [] });
    expect(parser.push('] and')).toEqual({ text: '[1] and', cited: [0] });
    expect(parser.push(' more')).toEqual({ text: ' more', cited: [] });
  });
});

describe('sourcePart', () => {
  it('is the page with the start of the chunk as its snippet', () => {
    expect(sourcePart(chunk('a', '  The Team\n plan   is $20. ', 'Pricing'))).toEqual({
      type: 'source',
      sourceId: 'page-a',
      url: 'https://example.test/a',
      title: 'Pricing',
      snippet: 'The Team plan is $20.',
    });
    const long = sourcePart(chunk('b', 'x'.repeat(500)));
    expect(long.snippet).toHaveLength(200);
    expect(long.snippet?.endsWith('…')).toBe(true);
    expect(long).not.toHaveProperty('title');
  });
});
