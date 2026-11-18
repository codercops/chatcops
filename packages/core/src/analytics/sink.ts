import { consoleLogger, type Logger } from '../logger.js';
import type { AnalyticsEvent } from '../types.js';
import type { EventSink } from '../storage/types.js';
import type { AnalyticsStats } from './collector.js';
import { ANALYTICS_EVENTS, countsByCurrentName } from './names.js';

const DEFAULT_MAX_BATCH = 50;
const DEFAULT_FLUSH_MS = 2000;

export class BufferedEventSink {
  private readonly events: AnalyticsEvent[] = [];
  private readonly maxBatch: number;
  private readonly flushMs: number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushPromise: Promise<void> | undefined;
  private readonly logger: Logger;

  constructor(
    private readonly sink: EventSink,
    options?: { maxBatch?: number; flushMs?: number; logger?: Logger }
  ) {
    this.logger = options?.logger ?? consoleLogger();
    this.maxBatch = options?.maxBatch ?? DEFAULT_MAX_BATCH;
    this.flushMs = options?.flushMs ?? DEFAULT_FLUSH_MS;

    if (!Number.isInteger(this.maxBatch) || this.maxBatch < 1) {
      throw new RangeError('maxBatch must be a positive integer.');
    }
    if (!Number.isFinite(this.flushMs) || this.flushMs < 0) {
      throw new RangeError('flushMs must be a non-negative finite number.');
    }
  }

  track(type: string, data?: Record<string, unknown>): void {
    const wasEmpty = this.events.length === 0;
    this.events.push({ type, data, timestamp: Date.now() });

    if (wasEmpty) this.scheduleFlush();
    if (this.events.length >= this.maxBatch) this.startAutomaticFlush();
  }

  flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;

    this.clearTimer();
    const drain = Promise.resolve().then(async () => {
      while (this.events.length > 0) {
        this.clearTimer();
        const batch = this.events.splice(0, this.maxBatch);

        try {
          await this.sink.write(batch);
        } catch (error) {
          this.logger.error('analytics_write_failed', `analytics write failed: ${errorMessage(error)}`);
        }
      }
    });

    const flushPromise = drain.finally(() => {
      if (this.flushPromise === flushPromise) this.flushPromise = undefined;
      if (this.events.length > 0) this.startAutomaticFlush();
    });
    this.flushPromise = flushPromise;
    return flushPromise;
  }

  private scheduleFlush(): void {
    try {
      const timer = setTimeout(() => {
        this.timer = undefined;
        this.startAutomaticFlush();
      }, this.flushMs);
      this.timer = timer;

      if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    } catch (error) {
      this.clearTimer();
      this.logger.error('analytics_flush_failed', `analytics timer failed: ${errorMessage(error)}`);
      this.startAutomaticFlush();
    }
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private startAutomaticFlush(): void {
    void this.flush().catch((error: unknown) => {
      this.logger.error('analytics_flush_failed', `analytics flush failed: ${errorMessage(error)}`);
    });
  }
}

export async function statsFromSink(
  sink: EventSink,
  range: { from: number; to: number }
): Promise<AnalyticsStats> {
  if (!sink.query) {
    throw new Error('Event sink does not support querying; implement EventSink.query to calculate analytics statistics.');
  }

  // Events stored under the names from before 0.8 still count.
  const eventCounts = countsByCurrentName((await sink.query(range)).map(({ type, count }) => [type, count] as [string, number]));

  const totalConversations = eventCounts.get(ANALYTICS_EVENTS.conversationStarted) ?? 0;
  const totalMessages =
    (eventCounts.get(ANALYTICS_EVENTS.messageSent) ?? 0) + (eventCounts.get(ANALYTICS_EVENTS.messageReceived) ?? 0);
  const leadsCaptured = eventCounts.get(ANALYTICS_EVENTS.leadCaptured) ?? 0;

  return {
    totalConversations,
    totalMessages,
    leadsCaptured,
    averageMessagesPerConversation: totalConversations > 0 ? totalMessages / totalConversations : 0,
    eventCounts: Object.fromEntries(eventCounts),
  };
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, ' ');
}
