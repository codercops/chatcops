import { AnalyticsCollector, type AnalyticsStats } from '@chatcops/core';

export class ServerAnalytics {
  private collector: AnalyticsCollector;

  constructor() {
    this.collector = new AnalyticsCollector();
  }

  track(event: string, data?: Record<string, unknown>): void {
    this.collector.track(event, data);
  }

  getStats(): AnalyticsStats {
    return this.collector.getStats();
  }
}
