import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhookDispatcher } from '../src/webhook.js';

describe('WebhookDispatcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches to matching webhook URLs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK', { status: 200 })
    );

    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/lead', events: ['lead:captured'] },
      { url: 'https://hooks.test/all', events: ['*'] },
    ]);

    await dispatcher.dispatch('lead:captured', { name: 'John' });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.test/lead',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hooks.test/all',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('skips non-matching events', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('OK', { status: 200 })
    );

    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/lead', events: ['lead:captured'] },
    ]);

    await dispatcher.dispatch('conversation:started', {});

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('retries on server errors', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return new Response('Error', { status: 500 });
      }
      return new Response('OK', { status: 200 });
    });

    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/hook', events: ['test'] },
    ]);

    await dispatcher.dispatch('test', {});

    expect(callCount).toBe(3);
  });

  it('throws on invalid URL in config', () => {
    expect(() => new WebhookDispatcher([
      { url: 'not-a-valid-url', events: ['test'] },
    ])).toThrow();
  });

  it('accepts valid URLs in config', () => {
    expect(() => new WebhookDispatcher([
      { url: 'https://hooks.test/webhook', events: ['test'] },
    ])).not.toThrow();
  });

  it('does not retry on client errors', async () => {
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      callCount++;
      return new Response('Bad Request', { status: 400 });
    });

    const dispatcher = new WebhookDispatcher([
      { url: 'https://hooks.test/hook', events: ['test'] },
    ]);

    await dispatcher.dispatch('test', {});

    expect(callCount).toBe(1);
  });
});
