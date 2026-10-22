import {
  Widget,
  type WidgetConfig,
  type WidgetEventType,
  type WidgetEventHandler,
} from './widget.js';

export {
  Widget,
  type WidgetConfig,
  type WidgetEventType,
  type WidgetEventHandler,
} from './widget.js';

let instance: Widget | null = null;
const persistentHandlers = new Map<WidgetEventType, Set<WidgetEventHandler>>();

export function parseAutoOpen(value?: string): boolean | number | undefined {
  if (value === undefined) return undefined;
  if (value === '' || value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return undefined;
}

const ChatCops = {
  init(config: WidgetConfig): Widget {
    if (instance) {
      instance.destroy();
    }
    instance = new Widget(config);
    for (const [event, handlers] of persistentHandlers) {
      for (const handler of handlers) {
        instance.on(event, handler);
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

  on(event: WidgetEventType, handler: WidgetEventHandler): () => void {
    let handlers = persistentHandlers.get(event);
    if (!handlers) {
      handlers = new Set();
      persistentHandlers.set(event, handlers);
    }
    handlers.add(handler);
    instance?.on(event, handler);
    return () => {
      ChatCops.off(event, handler);
    };
  },

  off(event: WidgetEventType, handler: WidgetEventHandler): void {
    persistentHandlers.get(event)?.delete(handler);
    instance?.off(event, handler);
  },
};

// Auto-init from script tag data attributes
function autoInit(script: HTMLScriptElement | null): void {
  if (!script) return;

  const apiUrl = script.dataset.apiUrl;
  if (!apiUrl) return;

  const mode = script.dataset.mode as 'popup' | 'inline' | undefined;
  const container = script.dataset.container;

  ChatCops.init({
    apiUrl,
    turnstileSiteKey: script.dataset.turnstileSiteKey,
    mode: mode || undefined,
    container: container || undefined,
    theme: {
      accent: script.dataset.accent,
      textColor: script.dataset.textColor,
      bgColor: script.dataset.bgColor,
      fontFamily: script.dataset.fontFamily,
      borderRadius: script.dataset.borderRadius,
      position: (script.dataset.position as 'bottom-right' | 'bottom-left') || undefined,
    },
    branding: {
      name: script.dataset.brandName,
      avatar: script.dataset.brandAvatar,
      subtitle: script.dataset.brandSubtitle,
    },
    welcomeMessage: script.dataset.welcomeMessage,
    welcomeBubble: script.dataset.welcomeBubble
      ? {
          text: script.dataset.welcomeBubble,
          delay: script.dataset.welcomeBubbleDelay ? parseInt(script.dataset.welcomeBubbleDelay, 10) : undefined,
        }
      : undefined,
    autoOpen: parseAutoOpen(script.dataset.autoOpen),
    placeholder: script.dataset.placeholder,
    locale: script.dataset.locale,
  });
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
