export interface Robots {
  allowed(url: string): boolean;
  sitemaps: string[];
  /** Minimum interval between requests, in seconds. */
  crawlDelay?: number;
}

interface Group {
  agents: string[];
  rules: { allow: boolean; path: string }[];
  delays: number[];
}

/** Normalize UTF-8 and percent-encoded unreserved octets before comparison. */
function normalize(path: string): string {
  return path.replace(/\P{ASCII}/gu, (char) => encodeURIComponent(char)).replace(/%[\da-f]{2}/gi, (encoded) => {
    const char = String.fromCharCode(Number.parseInt(encoded.slice(1), 16));
    return /[a-z\d._~-]/i.test(char) ? char : encoded.toUpperCase();
  });
}

/** Parse and combine all groups matching ChatCopsBot, falling back to '*'. */
export function parseRobots(text: string): Robots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let group: Group | undefined;
  let directives = false;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const clean = line.split('#')[0].trim();
    const colon = clean.indexOf(':');
    if (colon < 0) continue;
    const key = clean.slice(0, colon).trim().toLowerCase();
    const value = clean.slice(colon + 1).trim();
    if (key === 'sitemap') {
      if (value) sitemaps.push(value);
    } else if (key === 'user-agent') {
      if (!value) continue;
      if (!group || directives) {
        group = { agents: [], rules: [], delays: [] };
        groups.push(group);
        directives = false;
      }
      group.agents.push(value.toLowerCase());
    } else if (group && (key === 'allow' || key === 'disallow' || key === 'crawl-delay')) {
      directives = true;
      if (key === 'crawl-delay') {
        const seconds = Number(value);
        if (value && Number.isFinite(seconds) && seconds >= 0) group.delays.push(seconds);
      } else if (value.startsWith('/')) group.rules.push({ allow: key === 'allow', path: normalize(value) });
    }
  }
  const specific = groups.filter((entry) => entry.agents.includes('chatcopsbot'));
  const selected = specific.length ? specific : groups.filter((entry) => entry.agents.includes('*'));
  const rules = selected.flatMap((entry) => entry.rules).map((rule) => {
    const anchored = rule.path.endsWith('$');
    const path = anchored ? rule.path.slice(0, -1) : rule.path;
    const pattern = path.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return { ...rule, length: Buffer.byteLength(rule.path), test: new RegExp(`^${pattern}${anchored ? '$' : ''}`) };
  });
  const delays = selected.flatMap((entry) => entry.delays);
  return {
    sitemaps,
    ...(delays.length ? { crawlDelay: Math.max(...delays) } : {}),
    allowed(url) {
      const parsed = new URL(url);
      if (parsed.pathname === '/robots.txt') return true;
      const path = normalize(parsed.pathname + parsed.search);
      let longest = -1;
      let allow = true;
      for (const rule of rules) {
        if (rule.test.test(path) && (rule.length > longest || (rule.length === longest && rule.allow))) {
          longest = rule.length;
          allow = rule.allow;
        }
      }
      return allow;
    },
  };
}

/** Fetch a policy; callers cache this promise once per origin for each run. */
export async function robotsFor(origin: string, send: typeof fetch = fetch): Promise<Robots> {
  const fallback = (allowed: boolean): Robots => ({ allowed: () => allowed, sitemaps: [] });
  let url = new URL('/robots.txt', origin).href;
  try {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await send(url, {
        headers: { 'user-agent': 'ChatCopsBot/0.1 (+https://chat.codercops.com/bot)' },
        redirect: 'manual',
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status >= 400 && response.status < 500) return fallback(true);
      if (response.status >= 500) return fallback(false);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 5) return fallback(false);
        url = new URL(location, url).href;
        continue;
      }
      return response.ok ? parseRobots(await response.text()) : fallback(false);
    }
  } catch {
    // Network failures (including timeouts) mean the policy is unreachable.
  }
  return fallback(false);
}
