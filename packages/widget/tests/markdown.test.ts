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

  describe('code content is not processed as markdown', () => {
    it('keeps asterisks literal inside inline code (a*b*c)', () => {
      const result = renderMarkdown('use `a*b*c` here');
      expect(result).toContain('<code>a*b*c</code>');
      expect(result).not.toContain('<em>');
    });

    it('keeps bold markers literal inside inline code', () => {
      const result = renderMarkdown('`**not bold**`');
      expect(result).toContain('<code>**not bold**</code>');
      expect(result).not.toContain('<strong>');
    });

    it('keeps link syntax literal inside inline code', () => {
      const result = renderMarkdown('`[text](https://example.com)`');
      expect(result).toContain('<code>[text](https://example.com)</code>');
      expect(result).not.toContain('<a ');
    });

    it('keeps asterisks literal inside a code block', () => {
      const result = renderMarkdown('```\n*not italic* and **not bold**\n```');
      expect(result).toContain('<pre><code>*not italic* and **not bold**</code></pre>');
      expect(result).not.toContain('<em>');
      expect(result).not.toContain('<strong>');
    });

    it('keeps link syntax literal inside a code block', () => {
      const result = renderMarkdown('```\n[text](https://example.com)\n```');
      expect(result).toContain('<pre><code>[text](https://example.com)</code></pre>');
      expect(result).not.toContain('<a ');
    });

    it('keeps list-like lines literal inside a code block', () => {
      const result = renderMarkdown('```\n- item one\n1. item two\n```');
      expect(result).toContain('<pre><code>- item one\n1. item two</code></pre>');
      expect(result).not.toContain('<li>');
      expect(result).not.toContain('<ul>');
      expect(result).not.toContain('<ol>');
    });

    it('preserves newlines inside <pre><code> instead of converting them to <br>', () => {
      const result = renderMarkdown('```\nline1\nline2\n```');
      expect(result).toContain('<pre><code>line1\nline2</code></pre>');
      const code = /<pre><code>([\s\S]*?)<\/code><\/pre>/.exec(result)?.[1] ?? '';
      expect(code).toContain('\n');
      expect(code).not.toContain('<br>');
    });

    it('still escapes HTML inside code', () => {
      const inline = renderMarkdown('`<b>hi</b>`');
      expect(inline).toContain('<code>&lt;b&gt;hi&lt;/b&gt;</code>');
      const block = renderMarkdown('```\n<b>hi</b>\n```');
      expect(block).toContain('<pre><code>&lt;b&gt;hi&lt;/b&gt;</code></pre>');
    });
  });

  describe('headings', () => {
    it.each([1, 2, 3, 4, 5, 6])('renders a level %i heading', (level) => {
      const result = renderMarkdown(`${'#'.repeat(level)} Shipping options`);
      expect(result).toBe(`<h${level}>Shipping options</h${level}>`);
    });

    it('does not put a <br> right after a heading', () => {
      const result = renderMarkdown('### Shipping options\n\nWe ship worldwide.');
      expect(result).toBe('<h3>Shipping options</h3>We ship worldwide.');
    });

    it('needs a space after the hashes and seven is too many', () => {
      expect(renderMarkdown('#hashtag')).not.toContain('<h1>');
      expect(renderMarkdown('####### too deep')).not.toContain('<h');
    });

    it('keeps # literal inside inline code and code blocks', () => {
      expect(renderMarkdown('`# not a heading`')).toBe('<code># not a heading</code>');
      const block = renderMarkdown('```\n# comment\n```');
      expect(block).toBe('<pre><code># comment</code></pre>');
    });

    it('still escapes HTML inside a heading', () => {
      expect(renderMarkdown('## <b>hi</b>')).toBe('<h2>&lt;b&gt;hi&lt;/b&gt;</h2>');
    });
  });

  describe('bullet markers', () => {
    it.each(['*', '+'])('groups %s items into one <ul> like - items', (marker) => {
      const result = renderMarkdown(`${marker} Item 1\n${marker} Item 2`);
      expect(result).toBe('<ul><li>Item 1</li><li>Item 2</li></ul>');
    });

    it('renders bold text inside a * item', () => {
      const result = renderMarkdown('* **Free plan**: 100 messages\n* **Pro plan**: unlimited');
      expect(result).toBe(
        '<ul><li><strong>Free plan</strong>: 100 messages</li><li><strong>Pro plan</strong>: unlimited</li></ul>'
      );
    });

    it('renders a heading followed by a * list', () => {
      const result = renderMarkdown('### Plans\n* Free\n* Pro');
      expect(result).toBe('<h3>Plans</h3><ul><li>Free</li><li>Pro</li></ul>');
    });

    it('keeps * and + lines literal inside a code block', () => {
      const result = renderMarkdown('```\n* one\n+ two\n```');
      expect(result).toBe('<pre><code>* one\n+ two</code></pre>');
    });
  });

  describe('italic', () => {
    it('leaves asterisks with spaces around them alone', () => {
      const result = renderMarkdown('The total is 5 * 3 = 15 and 2 * 4 = 8.');
      expect(result).not.toContain('<em>');
      expect(result).toBe('The total is 5 * 3 = 15 and 2 * 4 = 8.');
    });

    it('still renders single-word and multi-word italic', () => {
      expect(renderMarkdown('*a*')).toBe('<em>a</em>');
      expect(renderMarkdown('an *italic phrase* here')).toBe('an <em>italic phrase</em> here');
    });

    it('keeps two one-letter italics on one line separate', () => {
      expect(renderMarkdown('*x* and *y*')).toBe('<em>x</em> and <em>y</em>');
      expect(renderMarkdown('Let *x* be 5 and *y* be 3')).toBe('Let <em>x</em> be 5 and <em>y</em> be 3');
    });
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
