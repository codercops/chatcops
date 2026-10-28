import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsCollector } from '../../src/analytics/collector.js';

describe('AnalyticsCollector', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores events with a timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:30:00.000Z'));

    const collector = new AnalyticsCollector();
    collector.track('conversation.started', { conversationId: 'conversation-1' });

    expect(collector.getEvents()).toEqual([
      {
        type: 'conversation.started',
        data: { conversationId: 'conversation-1' },
        timestamp: new Date('2026-01-15T12:30:00.000Z').getTime(),
      },
    ]);
  });

  it('keeps only the latest 1000 events', () => {
    const collector = new AnalyticsCollector();

    for (let i = 0; i < 1005; i++) {
      collector.track('test:event', { index: i });
    }

    const events = collector.getEvents();

    expect(events).toHaveLength(1000);
    expect(events[0].data).toEqual({ index: 5 });
    expect(events[999].data).toEqual({ index: 1004 });
  });

  it('counts unique conversations from conversation:started events', () => {
    const collector = new AnalyticsCollector();

    collector.track('conversation.started', { conversationId: 'conversation-1' });
    collector.track('conversation.started', { conversationId: 'conversation-1' });
    collector.track('conversation.started', { conversationId: 'conversation-2' });

    expect(collector.getStats().totalConversations).toBe(2);
  });

  it('counts sent and received messages toward totalMessages', () => {
    const collector = new AnalyticsCollector();

    collector.track('message.sent', { messageId: 'sent-1' });
    collector.track('message.sent', { messageId: 'sent-2' });
    collector.track('message.received', { messageId: 'received-1' });

    expect(collector.getStats().totalMessages).toBe(3);
  });

  it('counts lead.captured events', () => {
    const collector = new AnalyticsCollector();

    collector.track('lead.captured', { leadId: 'lead-1' });
    collector.track('lead.captured', { leadId: 'lead-2' });

    expect(collector.getStats().leadsCaptured).toBe(2);
  });

  it('calculates average messages per conversation', () => {
    const collector = new AnalyticsCollector();

    collector.track('conversation.started', { conversationId: 'conversation-1' });
    collector.track('conversation.started', { conversationId: 'conversation-2' });
    collector.track('message.sent', { messageId: 'sent-1' });
    collector.track('message.received', { messageId: 'received-1' });
    collector.track('message.received', { messageId: 'received-2' });

    expect(collector.getStats().averageMessagesPerConversation).toBe(1.5);
  });

  it('returns an average of zero when there are no conversations', () => {
    const collector = new AnalyticsCollector();

    collector.track('message.sent', { messageId: 'sent-1' });

    expect(collector.getStats().averageMessagesPerConversation).toBe(0);
  });

  it('returns a copy of events so mutations do not affect the collector', () => {
    const collector = new AnalyticsCollector();
    collector.track('message.sent', { messageId: 'sent-1' });

    const events = collector.getEvents();
    events.pop();
    events.push({ type: 'injected:event', timestamp: 0 });

    expect(collector.getEvents()).toEqual([
      {
        type: 'message.sent',
        data: { messageId: 'sent-1' },
        timestamp: expect.any(Number),
      },
    ]);
  });

  it('filters events by type', () => {
    const collector = new AnalyticsCollector();

    collector.track('message.sent', { messageId: 'sent-1' });
    collector.track('message.received', { messageId: 'received-1' });
    collector.track('message.sent', { messageId: 'sent-2' });

    expect(collector.getEvents('message.sent').map((event) => event.data?.messageId)).toEqual([
      'sent-1',
      'sent-2',
    ]);
    expect(collector.getEvents('message.received')).toHaveLength(1);
  });

  it('treats the names from before 0.8 as custom events', () => {
    const collector = new AnalyticsCollector();
    collector.track('message:sent');
    expect(collector.getStats()).toMatchObject({ totalMessages: 0, eventCounts: { 'message:sent': 1 } });
    expect(collector.getEvents('message.sent')).toEqual([]);
  });

  it('clears events and resets statistics', () => {
    const collector = new AnalyticsCollector();

    collector.track('conversation.started', { conversationId: 'conversation-1' });
    collector.track('message.sent', { messageId: 'sent-1' });
    collector.track('lead.captured', { leadId: 'lead-1' });

    collector.clear();

    expect(collector.getEvents()).toEqual([]);
    expect(collector.getStats()).toEqual({
      totalConversations: 0,
      totalMessages: 0,
      leadsCaptured: 0,
      averageMessagesPerConversation: 0,
      eventCounts: {},
    });
  });
});
