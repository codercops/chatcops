import { Widget, type WidgetConfig } from './widget.js';

export { Widget, type WidgetConfig } from './widget.js';

let instance: Widget | null = null;

const ChatCops = {
  init(config: WidgetConfig): Widget {
    if (instance) {
      instance.destroy();
    }
    instance = new Widget(config);
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

  on(event: string, handler: (...args: unknown[]) => void): void {
    instance?.on(event as 'open' | 'close' | 'message' | 'error', handler);
  },

  off(event: string, handler: (...args: unknown[]) => void): void {
    instance?.off(event as 'open' | 'close' | 'message' | 'error', handler);
  },
};

// Auto-init from script tag data attributes
function autoInit(): void {
  const script = document.currentScript as HTMLScriptElement | null;
  if (!script) return;

  const apiUrl = script.dataset.apiUrl;
  if (!apiUrl) return;

  const mode = script.dataset.mode as 'popup' | 'inline' | undefined;
  const container = script.dataset.container;

  ChatCops.init({
    apiUrl,
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
    autoOpen: script.dataset.autoOpen !== undefined
      ? (script.dataset.autoOpen === '' || script.dataset.autoOpen === 'true'
        ? true
        : parseInt(script.dataset.autoOpen, 10) || true)
      : undefined,
    placeholder: script.dataset.placeholder,
    locale: script.dataset.locale,
  });
}

// Capture currentScript synchronously, then init on DOMContentLoaded
const currentScript = document.currentScript;
if (currentScript && (currentScript as HTMLScriptElement).dataset.apiUrl) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
}

// Expose globally for IIFE builds
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).ChatCops = ChatCops;
}

export default ChatCops;
