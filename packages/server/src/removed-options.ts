const UPGRADE_GUIDE = 'https://chat.codercops.com/getting-started/upgrading-to-1/';

/** Options 1.0 removed, and what to use instead. */
const REMOVED: Record<string, string> = {
  cors: "`cors` was removed in 1.0. Use `allowedOrigins: ['https://your.site']`, which also takes several sites and wildcards.",
  conversationStore: '`conversationStore` was removed in 1.0. Use `storage: { conversations: yourStore }`, or a store package.',
  requireSession:
    '`requireSession` was removed in 1.0: session tokens are required by default. To accept chat requests without one (what `requireSession: false` did), set `allowAnonymous: true`.',
  i18n: "`i18n` was removed in 1.0. It did nothing since 0.6: set the chat's text with the widget's `strings` option.",
};

/**
 * Throws for a config that still sets an option 1.0 removed, so an upgrade
 * fails at startup with what to change instead of quietly behaving
 * differently (an open `cors` site, say, or conversations in memory).
 */
export function rejectRemovedOptions(config: object): void {
  for (const [option, message] of Object.entries(REMOVED)) {
    if (option in config && (config as Record<string, unknown>)[option] !== undefined) {
      throw new Error(`${message} See ${UPGRADE_GUIDE}`);
    }
  }
}
