import {
  Widget,
  type WidgetConfig,
  type WidgetEventType,
  type WidgetEventHandler,
} from './widget.js';
import { configFromScript } from './script-config.js';

export {
  Widget,
  type WidgetConfig,
  type WidgetEvents,
  type WidgetEventType,
  type WidgetEventHandler,
} from './widget.js';
export type { MessageData } from './dom/messages.js';
export { parseAutoOpen } from './script-config.js';

let instance: Widget | null = null;
const persistentHandlers = new Map<WidgetEventType, Set<WidgetEventHandler<never>>>();

const ChatCops = {
  init(config: WidgetConfig): Widget {
    if (instance) {
      instance.destroy();
    }
    instance = new Widget(config);
    for (const [event, handlers] of persistentHandlers) {
      for (const handler of handlers) {
        instance.on(event, handler as WidgetEventHandler);
      }
    }
    instance.init();
    return instance;
  },

  open(): void {
    instance?.open();
  },

  close(): void {
    instance?.close();
  },

  destroy(): void {
    instance?.destroy();
    instance = null;
  },

  on<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): () => void {
    let handlers = persistentHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      persistentHandlers.set(event, handlers);
    }
    handlers.add(handler as WidgetEventHandler<never>);
    instance?.on(event, handler);
    return () => {
      ChatCops.off(event, handler);
    };
  },

  off<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): void {
    persistentHandlers.get(event)?.delete(handler as WidgetEventHandler<never>);
    instance?.off(event, handler);
  },
};

// Auto-init from script tag data attributes
function autoInit(script: HTMLScriptElement | null): void {
  const config = script && configFromScript(script);
  if (config) ChatCops.init(config);
}

// Capture currentScript synchronously, then init on DOMContentLoaded
const currentScript = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null) : null;
if (currentScript && currentScript.dataset.apiUrl) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => autoInit(currentScript), { once: true });
  } else {
    autoInit(currentScript);
  }
}

// Expose globally for IIFE builds
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).ChatCops = ChatCops;
}

export default ChatCops;
