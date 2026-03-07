import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';

describe('renderMarkdown', () => {
  it('renders bold text', () => {
    expect(renderMarkdown('**hello**')).toContain('<strong>hello</strong>');
  });

  it('renders italic text', () => {
    expect(renderMarkdown('*hello*')).toContain('<em>hello</em>');
  });

  it('renders inline code', () => {
    expect(renderMarkdown('use `npm install`')).toContain('<code>npm install</code>');
  });

  it('renders code blocks', () => {
    const input = '```\nconst x = 1;\n```';
    const result = renderMarkdown(input);
    expect(result).toContain('<pre><code>');
    expect(result).toContain('const x = 1;');
  });

  it('renders links', () => {
    const result = renderMarkdown('[Click here](https://example.com)');
    expect(result).toContain('<a href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('Click here</a>');
  });

  it('renders unordered lists', () => {
    const input = '- Item 1\n- Item 2';
    const result = renderMarkdown(input);
    expect(result).toContain('<ul>');
    expect(result).toContain('<li>Item 1</li>');
    expect(result).toContain('<li>Item 2</li>');
  });

  it('escapes HTML to prevent injection', () => {
    const result = renderMarkdown('<script>alert("xss")</script>');
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('converts double newlines to breaks', () => {
    const result = renderMarkdown('Hello\n\nWorld');
    expect(result).toContain('<br><br>');
  });

  it('handles URLs with parentheses (Wikipedia-style)', () => {
    const input = '[Article](https://en.wikipedia.org/wiki/Rust_(programming_language))';
    const result = renderMarkdown(input);
    expect(result).toContain('href="https://en.wikipedia.org/wiki/Rust_(programming_language)"');
    expect(result).toContain('Article</a>');
  });

  it('handles mixed formatting', () => {
    const result = renderMarkdown('**bold** and *italic* and `code`');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
    expect(result).toContain('<code>code</code>');
  });
});
