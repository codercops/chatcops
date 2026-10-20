/**
 * Storage namespaces used by live widgets on this page. Two widgets that
 * share one would write into the same conversation, so a second widget
 * without its own `siteId` gets a separate namespace automatically.
 *
 * A claim only counts while its widget is live: not destroyed, and (once it
 * has mounted) with its host element still in the document. A widget removed
 * from the page without `destroy()`, for example by a single-page app
 * navigation, doesn't push the next widget off the default storage.
 */
const DEFAULT = '';
// Kept on globalThis so every copy of the widget on a page shares it, for example
// the script tag build and a bundled one, or two different versions.
const CLAIMS_KEY = Symbol.for('chatcops.storageClaims');
type Claims = Map<string, Set<() => boolean>>;
const store = globalThis as typeof globalThis & { [CLAIMS_KEY]?: Claims };
store[CLAIMS_KEY] ??= new Map();
const claims: Claims = store[CLAIMS_KEY];

export interface ClaimedNamespace {
  /** `undefined` means the default keys, which a single widget always gets. */
  siteId?: string;
  release(): void;
}

function inUse(name: string): boolean {
  const live = claims.get(name);
  if (!live) return false;
  for (const isLive of live) {
    if (!isLive()) live.delete(isLive);
  }
  if (live.size === 0) claims.delete(name);
  return live.size > 0;
}

export function claimNamespace(
  siteId: string | undefined,
  mode: 'popup' | 'inline',
  isLive: () => boolean
): ClaimedNamespace {
  let name = siteId ?? DEFAULT;

  if (siteId === undefined && inUse(DEFAULT)) {
    name = mode;
    for (let n = 2; inUse(name); n += 1) name = `${mode}-${n}`;
    console.warn(
      `[chatcops] Another widget on this page already uses the default storage, so this one keeps its conversation under "${name}". Set a \`siteId\` on each widget to name them yourself.`
    );
  } else if (siteId !== undefined && inUse(siteId)) {
    console.warn(`[chatcops] Two widgets on this page use the siteId "${siteId}", so they share one conversation.`);
  }

  if (!claims.has(name)) claims.set(name, new Set());
  claims.get(name)!.add(isLive);

  return {
    siteId: name === DEFAULT ? undefined : name,
    release() {
      claims.get(name)?.delete(isLive);
      if (claims.get(name)?.size === 0) claims.delete(name);
    },
  };
}
