import { Readability, isProbablyReaderable } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import type { ExtractedDoc } from './types.js';

/**
 * Where text that a visitor never sees sits in a page. Prompt injection
 * usually hides in exactly these places, so they're removed before anything
 * is read.
 */
const INVISIBLE = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'svg',
  'canvas',
  'object',
  'embed',
  '[hidden]',
  '[aria-hidden="true"]',
  '[style*="display:none"]',
  '[style*="display: none"]',
  '[style*="visibility:hidden"]',
  '[style*="visibility: hidden"]',
].join(',');

/** Page chrome, dropped when Readability can't find the article. */
const CHROME = 'nav, header, footer, aside, form, [role="navigation"], [role="banner"], [role="contentinfo"]';

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
turndown.use(gfm);
// Images and link targets are noise for search; the link text stays.
turndown.addRule('no-images', { filter: 'img', replacement: () => '' });
turndown.addRule('link-text', { filter: 'a', replacement: (content) => content });

/**
 * The readable content of an HTML page as Markdown. Hidden elements and
 * comments go first. Then `selector`, when given, picks the content;
 * otherwise Readability does, falling back to `<main>`, `<article>` or the
 * body without its navigation, header, footer and sidebars.
 */
export function extractHtml(html: string, url: string, selector?: string): ExtractedDoc {
  const { document } = parseHTML(html);
  const lang = document.documentElement?.getAttribute('lang')?.trim() || undefined;
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || undefined;
  const pageTitle =
    document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    document.querySelector('title')?.textContent?.trim() ||
    undefined;

  for (const element of [...document.querySelectorAll(INVISIBLE)]) element.remove();
  removeComments(document);

  let contentHtml: string | undefined;
  let title = pageTitle;
  if (selector) {
    contentHtml = document.querySelector(selector)?.outerHTML;
  }
  if (contentHtml === undefined && isProbablyReaderable(document as unknown as Document)) {
    const article = new Readability(document.cloneNode(true) as unknown as Document).parse();
    if (article?.content) {
      contentHtml = article.content;
      title = article.title?.trim() || title;
    }
  }
  if (contentHtml === undefined) {
    const root = document.querySelector('main') ?? document.querySelector('article') ?? document.body;
    for (const element of [...(root?.querySelectorAll(CHROME) ?? [])]) element.remove();
    contentHtml = root?.innerHTML ?? '';
  }

  return {
    url,
    ...(title ? { title } : {}),
    ...(lang ? { lang } : {}),
    ...(description ? { description } : {}),
    markdown: tidy(turndown.turndown(contentHtml)),
  };
}

/**
 * A Markdown or MDX file as a document: front matter gives the title and
 * description, and MDX `import`/`export` lines and component tags are
 * removed, keeping the text between tags.
 */
export function extractMarkdown(source: string, url: string): ExtractedDoc {
  let body = source.replace(/^\uFEFF/, '');
  const frontMatter: Record<string, string> = {};
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body);
  if (front) {
    for (const line of front[1].split(/\r?\n/)) {
      const field = /^(\w+):\s*(.*)$/.exec(line);
      if (field) frontMatter[field[1]] = field[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    body = body.slice(front[0].length);
  }
  body = withoutMdx(body);
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const title = frontMatter.title || heading;
  return {
    url,
    ...(title ? { title } : {}),
    ...(frontMatter.description ? { description: frontMatter.description } : {}),
    ...(frontMatter.lang ? { lang: frontMatter.lang } : {}),
    markdown: tidy(body),
  };
}

/** MDX syntax that isn't content, outside code fences. */
function withoutMdx(markdown: string): string {
  const out: string[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    const fence = /^\s*(```|~~~)/.test(line);
    if (inFence || fence) {
      out.push(line);
      if (fence) inFence = !inFence;
      continue;
    }
    if (/^\s*(import|export)\s/.test(line)) continue;
    out.push(line.replace(/<\/?[A-Z][\w.]*[^>]*>/g, ''));
  }
  return out.join('\n');
}

function removeComments(document: { createTreeWalker?: unknown; querySelectorAll: (s: string) => Iterable<unknown> }): void {
  const all = [document, ...(document.querySelectorAll('*') as Iterable<{ childNodes: ArrayLike<{ nodeType: number; remove(): void }> }>)];
  for (const node of all as Array<{ childNodes?: ArrayLike<{ nodeType: number; remove(): void }> }>) {
    for (const child of [...Array.from(node.childNodes ?? [])]) {
      if (child.nodeType === 8) child.remove();
    }
  }
}

/** At most one blank line in a row, no trailing spaces. */
function tidy(markdown: string): string {
  return markdown
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
