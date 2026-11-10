import { describe, expect, it, vi } from 'vitest';
import { extractHtml } from '../src/index.js';
import { PAGES } from './site.js';

// Workers bundles pick turndown's browser build, which parses a string with
// the page's `document`. A Worker has none, and neither does this test.
// @ts-expect-error The browser build ships without its own types.
vi.mock('turndown', async () => import('turndown/lib/turndown.browser.es.js'));

describe('extractHtml with the browser build of turndown', () => {
  it('converts a page with no global document, tables included', () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe('undefined');
    const doc = extractHtml(PAGES['/pricing'], 'https://acme.test/pricing');
    expect(doc.markdown).toContain('The Team plan costs $20 per user per month');
    expect(doc.markdown).toContain('## Enterprise');
    expect(doc.markdown).toMatch(/\| Plan \| Price \|/);
  });
});
