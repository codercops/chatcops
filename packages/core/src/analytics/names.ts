/**
 * The analytics events ChatCops tracks, named `noun.verb`. Before 0.8 they
 * were `noun:verb`; those names still work until 1.0: `track()` reads them
 * as the new ones, stats count events stored under either, and
 * `eventCounts` has both keys.
 */
export const ANALYTICS_EVENTS = {
  conversationStarted: 'conversation.started',
  messageSent: 'message.sent',
  messageReceived: 'message.received',
  leadCaptured: 'lead.captured',
} as const;

const LEGACY: Record<string, string> = {
  'conversation:started': ANALYTICS_EVENTS.conversationStarted,
  'message:sent': ANALYTICS_EVENTS.messageSent,
  'message:received': ANALYTICS_EVENTS.messageReceived,
  'lead:captured': ANALYTICS_EVENTS.leadCaptured,
};

/** The current name for an event type: an old `noun:verb` name becomes its `noun.verb` one. */
export function eventName(type: string): string {
  return LEGACY[type] ?? type;
}

/**
 * Counts by type with events under an old name added to the new one, and
 * the old key kept with the same total, so code that reads
 * `eventCounts['message:sent']` keeps working until 1.0.
 */
export function countsWithAliases(counts: Iterable<[string, number]>): Map<string, number> {
  const merged = new Map<string, number>();
  for (const [type, count] of counts) {
    const name = eventName(type);
    merged.set(name, (merged.get(name) ?? 0) + count);
  }
  for (const [old, name] of Object.entries(LEGACY)) {
    const total = merged.get(name);
    if (total !== undefined) merged.set(old, total);
  }
  return merged;
}
