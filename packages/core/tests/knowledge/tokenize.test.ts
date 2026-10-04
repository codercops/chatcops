import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/knowledge/tokenize.js';

describe('tokenize', () => {
  it('strips trailing punctuation', () => {
    expect(tokenize('pricing?')).toEqual(['pricing']);
  });

  it('keeps accented letters together', () => {
    expect(tokenize('réseau')).toEqual(['réseau']);
  });

  it('drops short words (length <= 2)', () => {
    expect(tokenize('hi there, ok?')).toEqual(['there']);
  });

  it('returns an empty array for punctuation-only input', () => {
    expect(tokenize('???')).toEqual([]);
  });
});
