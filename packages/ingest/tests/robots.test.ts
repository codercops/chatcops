import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseRobots, robotsFor } from '../src/robots.js';
import { fixtureSite, type FixtureSite } from './site.js';

const allowed = (text: string, path: string) => parseRobots(text).allowed(`https://example.com${path}`);

describe('robots parser', () => {
  it('selects and merges case-insensitive bot groups instead of the wildcard', () => {
    const rules = parseRobots(`User-Agent: *\nDisallow: /\nUser-Agent: OtherBot\nUser-Agent: CHATCOPSBOT\nDisallow: /one\n\nUser-agent: ChatCopsBot\nDisallow: /two`);
    expect(rules.allowed('https://example.com/one')).toBe(false);
    expect(rules.allowed('https://example.com/two')).toBe(false);
    expect(rules.allowed('https://example.com/other')).toBe(true);
    expect(allowed('User-agent: OtherBot\nDisallow: /', '/')).toBe(true);
    expect(allowed('User-agent: *\nDisallow: /', '/')).toBe(false);
  });

  it('uses the longest match, with allow winning equal-length ties in either order', () => {
    const text = 'User-agent: *\nDisallow: /docs\nAllow: /docs/public\nDisallow: /docs/public/private';
    expect(allowed(text, '/docs/intro')).toBe(false);
    expect(allowed(text, '/docs/public/intro')).toBe(true);
    expect(allowed(text, '/docs/public/private')).toBe(false);
    for (const pair of ['Allow: /same\nDisallow: /same', 'Disallow: /same\nAllow: /same']) {
      expect(allowed(`User-agent: *\n${pair}`, '/same')).toBe(true);
    }
  });

  it('supports wildcards, end anchors, query strings and literal regex characters', () => {
    const text = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /search?*\nDisallow: /a+b';
    expect(allowed(text, '/nested/a.pdf')).toBe(false);
    expect(allowed(text, '/nested/a.pdf?download=1')).toBe(true);
    expect(allowed(text, '/search?q=chat')).toBe(false);
    expect(allowed(text, '/a+b')).toBe(false);
    expect(allowed(text, '/ab')).toBe(true);
  });

  it('ignores comments, blank lines, malformed and empty rules, preserving path case', () => {
    const text = '\uFEFF# comment\nDisallow: /before\nUser-Agent:\nUser-Agent: *\n\n# gap\ndIsAlLoW: /Private # note\nAllow:\nDisallow:\nDisallow: bad\nignored\nUnknown: value';
    expect(allowed(text, '/Private')).toBe(false);
    expect(allowed(text, '/private')).toBe(true);
    expect(allowed(text, '/before')).toBe(true);
    expect(allowed('User-agent: *\nDisallow: /', '/robots.txt')).toBe(true);
    expect(allowed('', '/')).toBe(true);
  });

  it('normalizes UTF-8 and unreserved escapes without decoding reserved octets', () => {
    const text = 'User-agent: *\nDisallow: /café\nDisallow: /%7euser\nDisallow: /a%2fb';
    expect(allowed(text, '/caf%C3%A9')).toBe(false);
    expect(allowed(text, '/~user')).toBe(false);
    expect(allowed(text, '/a%2Fb')).toBe(false);
    expect(allowed(text, '/a/b')).toBe(true);
  });

  it('collects sitemaps globally and the largest valid selected crawl-delay', () => {
    const rules = parseRobots('Sitemap: https://example.com/a.xml\nUser-agent: *\nCrawl-delay: 99\nUser-agent: ChatCopsBot\nCrawl-delay: 0.1\nSITEMAP: https://example.com/b.xml\nSitemap:\nUser-agent: ChatCopsBot\nCrawl-delay: 0.2\nCrawl-delay: -1\nCrawl-delay: nope\nCrawl-delay: Infinity\nCrawl-delay:');
    expect(rules.sitemaps).toEqual(['https://example.com/a.xml', 'https://example.com/b.xml']);
    expect(rules.crawlDelay).toBe(0.2);
    expect(parseRobots('User-agent: *\nCrawl-delay: 0').crawlDelay).toBe(0);
    expect(parseRobots('').crawlDelay).toBeUndefined();
  });
});

describe('robots fetching', () => {
  let site: FixtureSite;
  beforeAll(async () => { site = await fixtureSite(); });
  afterAll(async () => { await site.close(); });

  it('allows everything for 404, blocks for 500 and an unreachable host', async () => {
    expect((await robotsFor(site.url)).allowed(`${site.url}/pricing`)).toBe(true);
    site.set('/robots.txt', 'unavailable', 'text/plain', 500);
    expect((await robotsFor(site.url)).allowed(`${site.url}/pricing`)).toBe(false);
    const offline = await fixtureSite();
    await offline.close();
    expect((await robotsFor(offline.url)).allowed(`${offline.url}/pricing`)).toBe(false);
  });

  it('follows five redirects, resolves relative locations and applies the final policy', async () => {
    site.set('/robots.txt', '', 'text/plain', 302, { location: '/r1' });
    for (let i = 1; i < 5; i++) site.set(`/r${i}`, '', 'text/plain', 301, { location: `/r${i + 1}` });
    site.set('/r5', 'User-agent: *\nDisallow: /pricing', 'text/plain');
    expect((await robotsFor(site.url)).allowed(`${site.url}/pricing`)).toBe(false);
    expect((await robotsFor(site.url)).allowed(`${site.url}/refunds`)).toBe(true);
    site.set('/r5', '', 'text/plain', 307, { location: '/robots.txt' });
    const start = site.requests.length;
    expect((await robotsFor(site.url)).allowed(`${site.url}/refunds`)).toBe(false);
    expect(site.requests.slice(start)).toHaveLength(6);
  });

  it('blocks a redirect without a location or an unexpected status', async () => {
    site.set('/robots.txt', '', 'text/plain', 302);
    expect((await robotsFor(site.url)).allowed(`${site.url}/pricing`)).toBe(false);
    site.set('/robots.txt', '', 'text/plain', 304);
    expect((await robotsFor(site.url)).allowed(`${site.url}/pricing`)).toBe(false);
  });
});
