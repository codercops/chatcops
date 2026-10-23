/** Returns the allowed entry that matches, or null. */
export function matchOrigin(origin: string | null, allowed: string[]): string | null {
  if (allowed.includes('*')) return '*';
  if (origin === null || origin === '' || origin === 'null') return null;
  return allowed.find((entry) => matchesEntry(origin, entry)) ?? null;
}

/** Returns CORS headers for a response to `origin`. */
export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const match = matchOrigin(origin, allowed);
  const headers: Record<string, string> = {};

  if (match === '*') {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (match !== null && origin !== null) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  if (!(allowed.length === 1 && allowed[0] === '*')) {
    headers.Vary = 'Origin';
  }

  return headers;
}

function matchesEntry(origin: string, configured: string): boolean {
  const normalized = configured.toLowerCase().replace(/\/+$/, '');
  const separator = normalized.indexOf('://');
  if (separator === -1) return false;

  const scheme = normalized.slice(0, separator);
  const authority = normalized.slice(separator + 3);
  const wildcardHost = authority.startsWith('*.');

  try {
    const requestUrl = new URL(origin);
    if (requestUrl.protocol !== `${scheme}:` || requestUrl.username || requestUrl.password) return false;

    if (!wildcardHost) return new URL(normalized).origin === requestUrl.origin;

    const baseUrl = new URL(`${scheme}://${authority.slice(2)}`);
    return (
      requestUrl.port === baseUrl.port &&
      requestUrl.hostname.endsWith(`.${baseUrl.hostname}`) &&
      requestUrl.hostname !== baseUrl.hostname
    );
  } catch {
    return false;
  }
}
