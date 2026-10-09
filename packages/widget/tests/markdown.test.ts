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

  it('renders ordered lists', () => {
    const result = renderMarkdown('1. First\n2. Second');
    expect(result).toContain('<ol>');
    expect(result).toContain('<li>First</li>');
    expect(result).toContain('<li>Second</li>');
    expect(result).not.toContain('<br>');
  });

  it('does not insert breaks between list items', () => {
    const ul = renderMarkdown('- A\n- B');
    expect(ul).toContain('<ul><li>A</li><li>B</li></ul>');
    const ol = renderMarkdown('1. A\n2. B');
    expect(ol).toContain('<ol><li>A</li><li>B</li></ol>');
  });

  it('keeps an unordered list followed by an ordered list separate', () => {
    const result = renderMarkdown('- a\n- b\n1. one\n2. two');
    expect(result).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(result).toContain('<ol><li>one</li><li>two</li></ol>');
    expect(result.indexOf('<ul>')).toBeLessThan(result.indexOf('<ol>'));
  });

  it('renders a list with text before and after it', () => {
    const result = renderMarkdown('Intro\n1. First\n2. Second\nOutro');
    expect(result).toContain('Intro');
    expect(result).toContain('<ol><li>First</li><li>Second</li></ol>');
    expect(result).toContain('Outro');
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

  describe('link schemes', () => {
    it.each([
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
    ])('renders %j as plain text', (url) => {
      const result = renderMarkdown(`[Click me](${url})`);
      expect(result).not.toContain('<a');
      expect(result).not.toContain('href=');
      expect(result).toContain('Click me');
    });

    it.each([
      'https://example.com',
      'http://example.com',
      'HTTPS://example.com',
      'mailto:hello@example.com',
      'tel:+15551234567',
      '/pricing',
      '#faq',
      '?plan=pro',
    ])('keeps %j as a link', (url) => {
      const result = renderMarkdown(`[Link](${url})`);
      expect(result).toContain(`<a href="${url}"`);
      expect(result).toContain('Link</a>');
    });
  });
});
