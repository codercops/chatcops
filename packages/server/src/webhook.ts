import type { WebhookConfig } from '@chatcops/core';

interface WebhookPayload {
  event: string;
  data: unknown;
  timestamp: number;
  signature?: string;
}

export class WebhookDispatcher {
  private configs: WebhookConfig[];
  private maxRetries = 3;

  constructor(configs: WebhookConfig[]) {
    for (const config of configs) {
      new URL(config.url); // throws on invalid URL
    }
    this.configs = configs;
  }

  async dispatch(event: string, data: unknown): Promise<void> {
    const matching = this.configs.filter((c) => c.events.includes(event) || c.events.includes('*'));

    await Promise.allSettled(
      matching.map((config) => this.send(config, event, data))
    );
  }

  private async send(config: WebhookConfig, event: string, data: unknown): Promise<void> {
    const payload: WebhookPayload = {
      event,
      data,
      timestamp: Date.now(),
    };

    if (config.secret) {
      payload.signature = await this.sign(JSON.stringify(payload), config.secret);
    }

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await fetch(config.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(payload.signature ? { 'X-ChatCops-Signature': payload.signature } : {}),
          },
          body: JSON.stringify(payload),
        });

        if (response.ok) return;
        if (response.status >= 400 && response.status < 500) return; // Don't retry client errors
      } catch {
        // Retry on network errors
      }

      if (attempt < this.maxRetries - 1) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }

  private async sign(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    return Array.from(new Uint8Array(signature))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
