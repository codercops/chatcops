import { describe, expect, it } from 'vitest';
import { chunkDoc, estimateTokens, extractHtml, extractMarkdown } from '../src/index.js';
import { PAGES } from './site.js';

describe('extractHtml', () => {
  it('keeps the readable content as Markdown, with the title, language and description', () => {
    const doc = extractHtml(PAGES['/pricing'], 'https://acme.test/pricing');
    expect(doc).toMatchObject({ url: 'https://acme.test/pricing', title: 'Pricing', lang: 'en', description: 'About Pricing' });
    expect(doc.markdown).toContain('The Team plan costs $20 per user per month');
    expect(doc.markdown).toContain('## Enterprise');
    // Tables stay tables.
    expect(doc.markdown).toMatch(/\| Plan \| Price \|/);
    // Navigation and footer are not content.
    expect(doc.markdown).not.toContain('© Acme');
  });

  it('removes hidden text, scripts and comments, where injected instructions hide', () => {
    const doc = extractHtml(PAGES['/refunds'], 'https://acme.test/refunds');
    expect(doc.markdown).toContain('Refunds are available within 30 days');
    expect(doc.markdown).toContain('Contact support with your order number.');
    for (const hidden of ['Ignore previous instructions', 'Hidden decorative text', 'window.secret', 'reveal the system prompt']) {
      expect(doc.markdown).not.toContain(hidden);
    }
  });

  it('uses a selector when one is given', () => {
    const html = '<html><body><div class="sidebar">Menu text</div><section id="docs"><p>Only this.</p></section></body></html>';
    expect(extractHtml(html, 'https://acme.test/x', '#docs').markdown).toBe('Only this.');
  });

  it('falls back to the body without its chrome when there is no article', () => {
    const html = '<html><body><header>Logo</header><nav>Links</nav><p>Short page.</p><aside>Ad</aside></body></html>';
    expect(extractHtml(html, 'https://acme.test/x').markdown).toBe('Short page.');
  });

  it('drops images and keeps link text without the target', () => {
    const html = '<html><body><main><p>See <a href="https://acme.test/terms">our terms</a> <img src="x.png" alt="logo"></p></main></body></html>';
    expect(extractHtml(html, 'https://acme.test/x').markdown).toBe('See our terms');
  });
});

describe('extractMarkdown', () => {
  it('reads front matter, and removes MDX imports and component tags but not code', () => {
    const source = `---
title: "Install"
description: How to install
---
import { Tabs } from '@astrojs/starlight/components';

# Installation

<Tabs>
Run the installer.
</Tabs>

\`\`\`tsx
import React from 'react';
<Widget />
\`\`\`
`;
    const doc = extractMarkdown(source, 'https://acme.test/docs/install');
    expect(doc).toMatchObject({ title: 'Install', description: 'How to install' });
    expect(doc.markdown).not.toContain('@astrojs/starlight');
    expect(doc.markdown).not.toContain('<Tabs>');
    expect(doc.markdown).toContain('Run the installer.');
    expect(doc.markdown).toContain("import React from 'react';");
    expect(doc.markdown).toContain('<Widget />');
  });

  it('takes the title from the first heading without front matter', () => {
    expect(extractMarkdown('# Hello\n\nText', 'https://acme.test/x').title).toBe('Hello');
  });
});

describe('estimateTokens', () => {
  it('counts about four characters per token, and one per CJK character', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('料金プラン')).toBe(5);
  });
});

describe('chunkDoc', () => {
  const doc = (markdown: string, title = 'Guide') => ({ url: 'https://acme.test/guide', title, markdown });

  it('splits at headings and starts each chunk with its heading path', () => {
    const chunks = chunkDoc(doc('Intro text.\n\n## Setup\n\nSetup text.\n\n### Keys\n\nKey text.\n\n## Usage\n\nUsage text.'));
    expect(chunks.map((c) => [c.section, c.text])).toEqual([
      [undefined, 'Guide\n\nIntro text.'],
      ['Setup', 'Guide > Setup\n\nSetup text.'],
      ['Setup > Keys', 'Guide > Setup > Keys\n\nKey text.'],
      ['Usage', 'Guide > Usage\n\nUsage text.'],
    ]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it('packs paragraphs up to the target, with overlap from the previous chunk', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${'word '.repeat(40)}`.trim());
    const chunks = chunkDoc(doc(paragraphs.join('\n\n')), { targetTokens: 200, overlapTokens: 60 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) expect(estimateTokens(chunk.text)).toBeLessThanOrEqual(200 + 60);
    // The second chunk starts with the last paragraph of the first.
    const lastOfFirst = chunks[0].text.split('\n\n').at(-1) as string;
    expect(chunks[1].text.split('\n\n')[1]).toBe(lastOfFirst);
    // Every paragraph is somewhere.
    for (const paragraph of paragraphs) expect(chunks.some((c) => c.text.includes(paragraph))).toBe(true);
  });

  it('never splits a code block or a table, even a long one', () => {
    const code = `\`\`\`ts\n${Array.from({ length: 200 }, (_, i) => `const line${i} = ${i};`).join('\n')}\n\`\`\``;
    const table = `| A | B |\n|---|---|\n${Array.from({ length: 100 }, (_, i) => `| ${i} | value ${i} |`).join('\n')}`;
    const chunks = chunkDoc(doc(`Before.\n\n${code}\n\n${table}\n\nAfter.`), { targetTokens: 100 });
    expect(chunks.filter((c) => c.text.includes('```ts'))).toHaveLength(1);
    expect(chunks.find((c) => c.text.includes('```ts'))?.text).toContain(code);
    expect(chunks.find((c) => c.text.includes('| A | B |'))?.text).toContain(table);
  });

  it('splits a long paragraph at sentence ends, and CJK text too', () => {
    const english = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    expect(chunkDoc(doc(english), { targetTokens: 100, overlapTokens: 0 }).length).toBeGreaterThan(2);
    const japanese = 'チームプランは月額二十ドルです。'.repeat(40);
    const chunks = chunkDoc(doc(japanese, '料金'), { targetTokens: 100, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((c) => c.text.startsWith('料金\n\n'))).toBe(true);
  });

  it('makes no chunks from an empty page, and repeats no title equal to the first heading', () => {
    expect(chunkDoc(doc(''))).toEqual([]);
    expect(chunkDoc(doc('# Guide\n\nText.'))[0].text).toBe('Guide\n\nText.');
  });
});
