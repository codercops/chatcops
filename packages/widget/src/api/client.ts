import type { WidgetChatRequest, WidgetChatChunk } from './types.js';

export interface ChatClientOptions {
  apiUrl: string;
  timeout?: number;
}

export class ChatClient {
  private apiUrl: string;
  private timeout: number;

  constructor(options: ChatClientOptions) {
    this.apiUrl = options.apiUrl;
    this.timeout = options.timeout ?? 30000;
  }

  async *sendMessage(request: WidgetChatRequest): AsyncGenerator<WidgetChatChunk> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          yield { error: 'rate_limit' };
          return;
        }
        yield { error: `HTTP ${response.status}` };
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        yield { error: 'No response body' };
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { done: true };
            return;
          }

          try {
            yield JSON.parse(data) as WidgetChatChunk;
          } catch {
            // Skip malformed chunks
          }
        }
      }

      yield { done: true };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        yield { error: 'timeout' };
      } else {
        yield { error: 'network' };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
