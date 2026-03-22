import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget } from '../src/widget.js';

describe('Widget lead capture handling', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fires the leadCaptured callback and event when the stream includes lead data', async () => {
    const onLeadCaptured = vi.fn();
    const widget = new Widget({
      apiUrl: 'https://api.test/chat',
      onLeadCaptured,
    });
    widget.init();

    const eventHandler = vi.fn();
    widget.on('leadCaptured', eventHandler);

    const sendMessage = vi.fn(async function* () {
      yield { leadCaptured: true, leadData: { email: 'lead@example.com' } };
      yield { content: 'Thanks, we will follow up soon.' };
      yield { done: true };
    });

    (widget as unknown as { client: { sendMessage: typeof sendMessage } }).client.sendMessage = sendMessage;

    await (widget as unknown as { handleSend(text: string): Promise<void> }).handleSend('Hello');

    expect(onLeadCaptured).toHaveBeenCalledWith({ email: 'lead@example.com' });
    expect(eventHandler).toHaveBeenCalledWith({ email: 'lead@example.com' });
  });
});
