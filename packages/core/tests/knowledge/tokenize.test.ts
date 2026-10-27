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

  it('keeps short words in Han, Hiragana, Katakana and Hangul', () => {
    expect(tokenize('料金')).toEqual(['料金']);
    expect(tokenize('价格')).toEqual(['价格']);
    expect(tokenize('환불')).toEqual(['환불']);
  });

  it('drops single hiragana particles but keeps single kanji and hangul', () => {
    expect(tokenize('は')).toEqual([]);
    expect(tokenize('金')).toEqual(['金']);
    expect(tokenize('税')).toEqual(['税']);
  });
});
