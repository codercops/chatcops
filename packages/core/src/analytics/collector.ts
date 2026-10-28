import type { AnalyticsEvent } from '../types.js';
import { ANALYTICS_EVENTS, countsWithAliases, eventName } from './names.js';

const MAX_EVENTS = 1000;

export interface AnalyticsStats {
  totalConversations: number;
  totalMessages: number;
  leadsCaptured: number;
  /** @deprecated Use `leadsCaptured`, the same number. Removed in 1.0. */
  leadsCapture: number;
  averageMessagesPerConversation: number;
  eventCounts: Record<string, number>;
}

export class AnalyticsCollector {
  private events: AnalyticsEvent[] = [];
  private conversationIds = new Set<string>();

  track(type: string, data?: Record<string, unknown>): void {
    const event: AnalyticsEvent = { type: eventName(type), data, timestamp: Date.now() };
    this.events.push(event);

    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    if (event.type === ANALYTICS_EVENTS.conversationStarted && data?.conversationId) {
      this.conversationIds.add(data.conversationId as string);
    }
  }

  getStats(): AnalyticsStats {
    const raw = new Map<string, number>();
    for (const event of this.events) raw.set(event.type, (raw.get(event.type) ?? 0) + 1);
    const counts = countsWithAliases(raw);
    const eventCounts = Object.fromEntries(counts);

    const totalConversations = this.conversationIds.size;
    const totalMessages = (counts.get(ANALYTICS_EVENTS.messageSent) ?? 0) + (counts.get(ANALYTICS_EVENTS.messageReceived) ?? 0);
    const leadsCaptured = counts.get(ANALYTICS_EVENTS.leadCaptured) ?? 0;

    return {
      totalConversations,
      totalMessages,
      leadsCaptured,
      leadsCapture: leadsCaptured,
      averageMessagesPerConversation: totalConversations > 0 ? totalMessages / totalConversations : 0,
      eventCounts,
    };
  }

  getEvents(type?: string): AnalyticsEvent[] {
    if (type) {
      const name = eventName(type);
      return this.events.filter((e) => e.type === name);
    }
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.conversationIds.clear();
  }
}
