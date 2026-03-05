import type { AnalyticsEvent } from '../types.js';

const MAX_EVENTS = 1000;

export interface AnalyticsStats {
  totalConversations: number;
  totalMessages: number;
  leadsCapture: number;
  averageMessagesPerConversation: number;
  eventCounts: Record<string, number>;
}

export class AnalyticsCollector {
  private events: AnalyticsEvent[] = [];
  private conversationIds = new Set<string>();

  track(type: string, data?: Record<string, unknown>): void {
    const event: AnalyticsEvent = { type, data, timestamp: Date.now() };
    this.events.push(event);

    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    if (type === 'conversation:started' && data?.conversationId) {
      this.conversationIds.add(data.conversationId as string);
    }
  }

  getStats(): AnalyticsStats {
    const eventCounts: Record<string, number> = {};
    for (const event of this.events) {
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1;
    }

    const totalConversations = this.conversationIds.size;
    const totalMessages = (eventCounts['message:sent'] ?? 0) + (eventCounts['message:received'] ?? 0);

    return {
      totalConversations,
      totalMessages,
      leadsCapture: eventCounts['lead:captured'] ?? 0,
      averageMessagesPerConversation: totalConversations > 0 ? totalMessages / totalConversations : 0,
      eventCounts,
    };
  }

  getEvents(type?: string): AnalyticsEvent[] {
    if (type) return this.events.filter((e) => e.type === type);
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.conversationIds.clear();
  }
}
