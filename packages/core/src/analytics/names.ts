/** The analytics events ChatCops tracks, named `noun.verb`. */
export const ANALYTICS_EVENTS = {
  conversationStarted: 'conversation.started',
  messageSent: 'message.sent',
  messageReceived: 'message.received',
  leadCaptured: 'lead.captured',
} as const;

/** The names before 0.8, which a store may still hold events under. */
const STORED_BEFORE_0_8: Record<string, string> = {
  'conversation:started': ANALYTICS_EVENTS.conversationStarted,
  'message:sent': ANALYTICS_EVENTS.messageSent,
  'message:received': ANALYTICS_EVENTS.messageReceived,
  'lead:captured': ANALYTICS_EVENTS.leadCaptured,
};

/**
 * Counts by type, with events a store saved under a name from before 0.8
 * added to the current name, so totals don't drop for history from then.
 */
export function countsByCurrentName(counts: Iterable<[string, number]>): Map<string, number> {
  const merged = new Map<string, number>();
  for (const [type, count] of counts) {
    const name = STORED_BEFORE_0_8[type] ?? type;
    merged.set(name, (merged.get(name) ?? 0) + count);
  }
  return merged;
}
