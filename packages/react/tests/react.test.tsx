import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageData } from '@chatcops/widget';

type EventHandler = (...args: unknown[]) => void;

const handlers = new Map<string, Set<EventHandler>>();

const mockWidget = {
  init: vi.fn(),
  destroy: vi.fn(),
  update: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  toggle: vi.fn(),
  sendMessage: vi.fn().mockResolvedValue(undefined),
  on: vi.fn((event: string, handler: EventHandler) => {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(handler);
    return () => {
      mockWidget.off(event, handler);
    };
  }),
  off: vi.fn((event: string, handler: EventHandler) => {
    handlers.get(event)?.delete(handler);
  }),
  emit(event: string, ...args: unknown[]) {
    handlers.get(event)?.forEach((h) => {
      h(...args);
    });
  },
  getHandlers(event: string) {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    return set;
  },
  clearHandlers() {
    handlers.clear();
  },
};

vi.mock('@chatcops/widget', () => ({
  default: mockWidget,
}));

import { ChatCops, useChatCops } from '../src/index.js';

describe('@chatcops/react', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useChatCops calls do nothing before the widget has loaded', async () => {
    const { result } = renderHook(() => useChatCops());
    expect(() => result.current.open()).not.toThrow();
    expect(() => result.current.close()).not.toThrow();
    expect(() => result.current.toggle()).not.toThrow();
    expect(() => result.current.update({ welcomeMessage: 'hi' })).not.toThrow();
    await expect(result.current.send('test')).resolves.toBeUndefined();
    expect(mockWidget.open).not.toHaveBeenCalled();
    expect(mockWidget.sendMessage).not.toHaveBeenCalled();
  });

  it('server-rendering returns an empty string and does not throw', () => {
    const html = renderToString(<ChatCops apiUrl="/api/chat" />);
    expect(html).toBe('');
    expect(mockWidget.init).not.toHaveBeenCalled();
  });

  it('mounts one widget and strips callback props from config', async () => {
    render(
      <ChatCops
        apiUrl="/api/chat"
        branding={{ name: 'Acme' }}
        onOpen={() => {}}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalledTimes(1);
    });

    expect(mockWidget.init).toHaveBeenCalledWith({
      apiUrl: '/api/chat',
      branding: { name: 'Acme' },
    });
  });

  it('StrictMode leaves exactly one widget and one set of listeners', async () => {
    mockWidget.init.mockClear();
    mockWidget.destroy.mockClear();
    mockWidget.clearHandlers();

    render(
      <StrictMode>
        <ChatCops apiUrl="/api/chat" />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalled();
    });

    for (const event of ['open', 'close', 'message', 'error', 'leadCaptured', 'preChatSubmit']) {
      expect(mockWidget.getHandlers(event).size).toBe(1);
    }
  });

  it('unmounting destroys the widget and removes all listeners', async () => {
    mockWidget.clearHandlers();
    const { unmount } = render(<ChatCops apiUrl="/api/chat" />);

    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalled();
    });

    unmount();
    expect(mockWidget.destroy).toHaveBeenCalled();

    for (const event of ['open', 'close', 'message', 'error', 'leadCaptured', 'preChatSubmit']) {
      expect(mockWidget.getHandlers(event).size).toBe(0);
    }
  });

  it('a branding change calls update() and not init()', async () => {
    const { rerender } = render(<ChatCops apiUrl="/api/chat" branding={{ name: 'Acme' }} />);
    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalledTimes(1);
    });

    mockWidget.init.mockClear();
    mockWidget.update.mockClear();

    rerender(<ChatCops apiUrl="/api/chat" branding={{ name: 'Acme Corp' }} />);

    await waitFor(() => {
      expect(mockWidget.update).toHaveBeenCalledWith({
        branding: { name: 'Acme Corp' },
      });
    });
    expect(mockWidget.init).not.toHaveBeenCalled();
  });

  it('other update props call update() and not init()', async () => {
    const { rerender } = render(
      <ChatCops
        apiUrl="/api/chat"
        welcomeMessage="Hello"
        suggestions={['Pricing']}
        placeholder="Ask..."
        privacyUrl="https://example.com/privacy"
        disclosure={{ text: 'AI' }}
        theme={{ tokens: { primary: '#000' } }}
      />,
    );
    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalledTimes(1);
    });

    mockWidget.init.mockClear();
    mockWidget.update.mockClear();

    rerender(
      <ChatCops
        apiUrl="/api/chat"
        welcomeMessage="Welcome!"
        suggestions={['Pricing', 'Docs']}
        placeholder="Type a message..."
        privacyUrl="https://example.com/privacy2"
        disclosure={{ text: 'AI Bot' }}
        theme={{ tokens: { primary: '#111' } }}
      />,
    );

    await waitFor(() => {
      expect(mockWidget.update).toHaveBeenCalledWith(
        expect.objectContaining({
          welcomeMessage: 'Welcome!',
          suggestions: ['Pricing', 'Docs'],
          placeholder: 'Type a message...',
          privacyUrl: 'https://example.com/privacy2',
          disclosure: { text: 'AI Bot' },
          theme: { tokens: { primary: '#111' } },
        }),
      );
    });
    expect(mockWidget.init).not.toHaveBeenCalled();
  });

  it('an apiUrl change inits again', async () => {
    const { rerender } = render(<ChatCops apiUrl="/api/v1" />);
    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalledTimes(1);
    });

    mockWidget.init.mockClear();

    rerender(<ChatCops apiUrl="/api/v2" />);

    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalledWith(expect.objectContaining({ apiUrl: '/api/v2' }));
    });
  });

  it('a theme.position change inits again', async () => {
    const { rerender } = render(
      <ChatCops apiUrl="/api/chat" theme={{ position: 'bottom-right' }} />,
    );
    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalledTimes(1);
    });

    mockWidget.init.mockClear();
    mockWidget.update.mockClear();

    rerender(<ChatCops apiUrl="/api/chat" theme={{ position: 'bottom-left' }} />);

    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalledWith(
        expect.objectContaining({
          theme: { position: 'bottom-left' },
        }),
      );
    });
    expect(mockWidget.update).not.toHaveBeenCalled();
  });

  it('a mode change inits again', async () => {
    const { rerender } = render(<ChatCops apiUrl="/api/chat" mode="popup" />);
    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalledTimes(1);
    });

    mockWidget.init.mockClear();

    rerender(<ChatCops apiUrl="/api/chat" mode="inline" container="#container" />);

    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'inline',
          container: '#container',
        }),
      );
    });
  });

  it('onLeadCaptured fires and survives re-renders', async () => {
    const lead1 = vi.fn();
    const lead2 = vi.fn();
    mockWidget.on.mockClear();

    const { rerender } = render(<ChatCops apiUrl="/api/chat" onLeadCaptured={lead1} />);
    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalled();
    });

    const initialOnCalls = mockWidget.on.mock.calls.length;

    rerender(<ChatCops apiUrl="/api/chat" onLeadCaptured={lead2} />);
    expect(mockWidget.on).toHaveBeenCalledTimes(initialOnCalls);

    act(() => {
      mockWidget.emit('leadCaptured', { email: 'user@example.com' });
    });

    expect(lead1).not.toHaveBeenCalled();
    expect(lead2).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('all widget event props fire and survive re-renders', async () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onPreChatSubmit = vi.fn();

    render(
      <ChatCops
        apiUrl="/api/chat"
        onOpen={onOpen}
        onClose={onClose}
        onMessage={onMessage}
        onError={onError}
        onPreChatSubmit={onPreChatSubmit}
      />,
    );

    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalled();
    });

    act(() => {
      mockWidget.emit('open');
      mockWidget.emit('close');
      mockWidget.emit('message', { id: 'm1', role: 'user', content: 'hello' } as MessageData);
      mockWidget.emit('error', new Error('boom'));
      mockWidget.emit('preChatSubmit', { topic: 'billing' });
    });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith({ id: 'm1', role: 'user', content: 'hello' });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onPreChatSubmit).toHaveBeenCalledWith({ topic: 'billing' });
  });

  it('useChatCops().send() reaches sendMessage and all handle methods work', async () => {
    function TestApp() {
      const chat = useChatCops();
      return (
        <div>
          <ChatCops apiUrl="/api/chat" />
          <button type="button" onClick={() => chat.open()}>Open</button>
          <button type="button" onClick={() => chat.close()}>Close</button>
          <button type="button" onClick={() => chat.toggle()}>Toggle</button>
          <button type="button" onClick={() => chat.send('Is this in stock?', { open: false })}>Ask</button>
          <button type="button" onClick={() => chat.update({ placeholder: 'Ask here' })}>Update</button>
        </div>
      );
    }

    const { getByText } = render(<TestApp />);
    await waitFor(() => {
      expect(mockWidget.init).toHaveBeenCalled();
    });

    act(() => {
      getByText('Open').click();
      getByText('Close').click();
      getByText('Toggle').click();
      getByText('Ask').click();
      getByText('Update').click();
    });

    expect(mockWidget.open).toHaveBeenCalledTimes(1);
    expect(mockWidget.close).toHaveBeenCalledTimes(1);
    expect(mockWidget.toggle).toHaveBeenCalledTimes(1);
    expect(mockWidget.sendMessage).toHaveBeenCalledWith('Is this in stock?', { open: false });
    expect(mockWidget.update).toHaveBeenCalledWith({ placeholder: 'Ask here' });
  });
});
