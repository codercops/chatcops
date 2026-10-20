import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import ChatCops, { parseAutoOpen, type WidgetEventType } from '../src/index.js';

describe('ChatCops browser export and auto-init', () => {

  it.each([
    [undefined, undefined], ['', true], ['true', true], ['false', false], ['1500', 1500], ['0', 0], ['nope', undefined],
  ])('parses data-auto-open %j', (value, expected) => {
    expect(parseAutoOpen(value)).toBe(expected);
  });
  const bundlePath = resolve(__dirname, '../dist/chatcops.min.js');
  let bundleCode: string;

  beforeEach(() => {
    document.body.innerHTML = '';
    bundleCode = readFileSync(bundlePath, 'utf-8');
  });

  afterEach(() => {
    ChatCops.destroy();
    document.body.innerHTML = '';
  });

  describe('browser global export', () => {
    it('exposes init and controls on window.ChatCops without requiring .default', () => {
      expect(typeof window.ChatCops).toBe('object');
      expect(typeof window.ChatCops.init).toBe('function');
      expect(typeof window.ChatCops.open).toBe('function');
      expect(typeof window.ChatCops.close).toBe('function');
      expect(typeof window.ChatCops.destroy).toBe('function');
      expect(typeof window.ChatCops.on).toBe('function');
      expect(typeof window.ChatCops.off).toBe('function');
    });

    it('initializes widget directly via window.ChatCops.init', () => {
      const container = document.createElement('div');
      container.id = 'manual-container';
      document.body.appendChild(container);

      const instance = window.ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#manual-container',
      });

      expect(instance).toBeDefined();
      const root = container.querySelector('#chatcops-root');
      expect(root).not.toBeNull();
      expect(root?.shadowRoot).toBeDefined();

      window.ChatCops.destroy();
      expect(container.querySelector('#chatcops-root')).toBeNull();
    });

    it('built IIFE bundle exposes window.ChatCops.init directly without .default', () => {
      const container = document.createElement('div');
      container.id = 'bundle-container';
      document.body.appendChild(container);

      // Evaluate the built bundle in window context
      window.eval(bundleCode);

      // Verify global export on window
      const globalChatCops = (window as unknown as { ChatCops: Record<string, unknown> }).ChatCops;
      expect(typeof globalChatCops).toBe('object');
      expect(typeof globalChatCops.init).toBe('function');
      expect(typeof globalChatCops.Widget).toBe('function');
      expect(typeof (globalChatCops as Record<string, unknown>).default).toBe('object');

      // window.ChatCops.init works directly without .default
      const initFn = globalChatCops.init as (config: unknown) => unknown;
      const instance = initFn({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#bundle-container',
      });

      expect(instance).toBeDefined();
      expect(container.querySelector('#chatcops-root')).not.toBeNull();

      if (typeof globalChatCops.destroy === 'function') {
        (globalChatCops.destroy as () => void)();
      }
    });
  });

  describe('deferred auto-init with captured script element', () => {
    it('defers auto-init on DOMContentLoaded and uses captured script element even if document.currentScript becomes null', () => {
      const container = document.createElement('div');
      container.id = 'auto-container';
      document.body.appendChild(container);

      const script = document.createElement('script');
      script.dataset.apiUrl = 'https://api.test/chat';
      script.dataset.mode = 'inline';
      script.dataset.container = '#auto-container';
      script.dataset.brandName = 'TestBot';
      document.head.appendChild(script);

      // Simulate browser parsing script while document is loading
      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true,
        writable: true,
      });

      Object.defineProperty(document, 'currentScript', {
        value: script,
        configurable: true,
        writable: true,
      });

      // Execute the bundle while loading
      window.eval(bundleCode);

      // Simulate browser finishing synchronous script evaluation: currentScript becomes null
      Object.defineProperty(document, 'currentScript', {
        value: null,
        configurable: true,
        writable: true,
      });

      // Confirm widget has not initialized yet because DOMContentLoaded has not fired
      expect(container.querySelector('#chatcops-root')).toBeNull();

      // Fire DOMContentLoaded event
      document.dispatchEvent(new Event('DOMContentLoaded'));

      // The captured script element should have been used, auto-initializing the inline widget
      const root = container.querySelector('#chatcops-root');
      expect(root).not.toBeNull();
      expect(root?.shadowRoot).toBeDefined();

      const panel = root?.shadowRoot?.querySelector('.cc-panel');
      expect(panel).not.toBeNull();
      expect(panel?.classList.contains('cc-inline')).toBe(true);
      expect(root?.shadowRoot?.querySelector('.cc-fab')).toBeNull();

      // Clean up
      window.ChatCops.destroy();
      document.head.removeChild(script);
    });

    it('auto-inits immediately when document.readyState is complete', () => {
      const container = document.createElement('div');
      container.id = 'immediate-container';
      document.body.appendChild(container);

      const script = document.createElement('script');
      script.dataset.apiUrl = 'https://api.test/chat';
      script.dataset.mode = 'inline';
      script.dataset.container = '#immediate-container';
      document.head.appendChild(script);

      Object.defineProperty(document, 'readyState', {
        value: 'complete',
        configurable: true,
        writable: true,
      });

      Object.defineProperty(document, 'currentScript', {
        value: script,
        configurable: true,
        writable: true,
      });

      window.eval(bundleCode);

      expect(container.querySelector('#chatcops-root')).not.toBeNull();

      // Clean up
      window.ChatCops.destroy();
      document.head.removeChild(script);
    });

    it('does not auto-init when script tag does not have data-api-url', () => {
      const container = document.createElement('div');
      container.id = 'no-api-container';
      document.body.appendChild(container);

      const script = document.createElement('script');
      script.dataset.mode = 'inline';
      script.dataset.container = '#no-api-container';
      document.head.appendChild(script);

      Object.defineProperty(document, 'readyState', {
        value: 'complete',
        configurable: true,
        writable: true,
      });

      Object.defineProperty(document, 'currentScript', {
        value: script,
        configurable: true,
        writable: true,
      });

      window.eval(bundleCode);

      expect(container.querySelector('#chatcops-root')).toBeNull();

      // Clean up
      document.head.removeChild(script);
    });
  });

  describe('event registry and subscriptions', () => {
    let cleanups: Array<() => void> = [];

    afterEach(() => {
      cleanups.forEach((c) => {
        c();
      });
      cleanups = [];
      ChatCops.destroy();
    });

    it('attaches handlers registered before initialization when instance is created', () => {
      const onOpen = vi.fn();
      const unsub = ChatCops.on('open', onOpen);
      cleanups.push(unsub);

      const container = document.createElement('div');
      container.id = 'event-container-1';
      document.body.appendChild(container);

      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#event-container-1',
      });

      ChatCops.open();
      expect(onOpen).toHaveBeenCalledOnce();
    });

    it('attaches handlers registered by an inline script before DOMContentLoaded', () => {
      const container = document.createElement('div');
      container.id = 'event-container-auto';
      document.body.appendChild(container);

      const script = document.createElement('script');
      script.dataset.apiUrl = 'https://api.test/chat';
      script.dataset.mode = 'inline';
      script.dataset.container = '#event-container-auto';
      document.head.appendChild(script);

      Object.defineProperty(document, 'readyState', {
        value: 'loading',
        configurable: true,
        writable: true,
      });

      Object.defineProperty(document, 'currentScript', {
        value: script,
        configurable: true,
        writable: true,
      });

      // Execute bundle while document is loading (simulates script tag execution)
      window.eval(bundleCode);

      // Inline script runs before DOMContentLoaded
      const onOpen = vi.fn();
      const unsub = window.ChatCops.on('open', onOpen);

      // Dispatch DOMContentLoaded
      document.dispatchEvent(new Event('DOMContentLoaded'));

      window.ChatCops.open();
      expect(onOpen).toHaveBeenCalledOnce();

      unsub();
      document.head.removeChild(script);
    });

    it('preserves registered handlers across repeated init() calls and attaches each exactly once', () => {
      const onOpen = vi.fn();
      const unsub = ChatCops.on('open', onOpen);
      cleanups.push(unsub);

      const container = document.createElement('div');
      container.id = 'reinit-container';
      document.body.appendChild(container);

      // First init
      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#reinit-container',
      });

      ChatCops.open();
      expect(onOpen).toHaveBeenCalledTimes(1);

      ChatCops.close();

      // Second init (re-initialization)
      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#reinit-container',
      });

      ChatCops.open();
      // Should have been called a second time (persisted), but exactly once for this open call (not duplicated)
      expect(onOpen).toHaveBeenCalledTimes(2);
    });

    it('removes registration when unsubscribe function is called before init()', () => {
      const onOpen = vi.fn();
      const unsub = ChatCops.on('open', onOpen);
      unsub(); // unsubscribe before init

      const container = document.createElement('div');
      container.id = 'unsub-before-init';
      document.body.appendChild(container);

      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#unsub-before-init',
      });

      ChatCops.open();
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('removes registration when unsubscribe function is called after init() and persists removal across re-init', () => {
      const onOpen = vi.fn();
      const container = document.createElement('div');
      container.id = 'unsub-after-init';
      document.body.appendChild(container);

      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#unsub-after-init',
      });

      const unsub = ChatCops.on('open', onOpen);
      unsub(); // unsubscribe after init

      ChatCops.open();
      expect(onOpen).not.toHaveBeenCalled();

      // Re-init should also not have the handler
      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#unsub-after-init',
      });

      ChatCops.open();
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('removes handler from persistent registry and active instance via ChatCops.off()', () => {
      const onOpen = vi.fn();
      const container = document.createElement('div');
      container.id = 'off-container';
      document.body.appendChild(container);

      ChatCops.on('open', onOpen);

      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#off-container',
      });

      ChatCops.off('open', onOpen);

      ChatCops.open();
      expect(onOpen).not.toHaveBeenCalled();

      // Verify removal persisted across re-initialization
      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#off-container',
      });

      ChatCops.open();
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('removes handler from persistent registry when ChatCops.off() is called before init()', () => {
      const onOpen = vi.fn();
      const container = document.createElement('div');
      container.id = 'off-before-container';
      document.body.appendChild(container);

      ChatCops.on('open', onOpen);
      ChatCops.off('open', onOpen);

      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#off-before-container',
      });

      ChatCops.open();
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('attaches duplicate registrations of the same handler exactly once', () => {
      const onOpen = vi.fn();
      const unsub1 = ChatCops.on('open', onOpen);
      const unsub2 = ChatCops.on('open', onOpen);
      cleanups.push(unsub1, unsub2);

      const container = document.createElement('div');
      container.id = 'dedup-container';
      document.body.appendChild(container);

      ChatCops.init({
        apiUrl: 'https://api.test/chat',
        mode: 'inline',
        container: '#dedup-container',
      });

      ChatCops.open();
      expect(onOpen).toHaveBeenCalledOnce();
    });

    it('supports all WidgetEventType events in ChatCops.on and ChatCops.off', () => {
      const events: WidgetEventType[] = ['open', 'close', 'message', 'error', 'leadCaptured', 'preChatSubmit'];
      for (const ev of events) {
        const handler = vi.fn();
        const unsub = ChatCops.on(ev, handler);
        ChatCops.off(ev, handler);
        unsub();
      }
    });
  });
});
