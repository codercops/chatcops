import {
  Widget,
  type WidgetConfig,
  type WidgetUpdate,
  type WidgetEventType,
  type WidgetEventHandler,
} from './widget.js';
import { configFromScript } from './script-config.js';
import { setLanguageDirection } from './dom/shadow.js';
import { registerWidgetLocale, type WidgetLocaleStrings } from './i18n.js';
import { VERSION } from './version.js';

export {
  Widget,
  type WidgetConfig,
  type WidgetUpdate,
  type PreChatField,
  type PreChatFormConfig,
  type WidgetEvents,
  type WidgetEventType,
  type WidgetEventHandler,
} from './widget.js';
export type { MessageData, MessageErrorType, MessageStatus } from './dom/messages.js';
export type { ThemeConfig, ThemeMode } from './theme.js';
export type { Persistence } from './storage.js';
export type { WidgetLocaleStrings } from './i18n.js';
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

  toggle(): void {
    instance?.toggle();
  },

  /** Sends `text` as the visitor (opening the chat unless `open: false`); resolves when the reply is done. */
  sendMessage(text: string, options?: { open?: boolean }): Promise<void> {
    return instance?.sendMessage(text, options) ?? Promise.resolve();
  },

  /** A fresh conversation: new id, the log back to the welcome message. */
  newConversation(): void {
    instance?.newConversation();
  },

  /** A fresh conversation, and the saved transcript and pre-chat answers removed from this browser. */
  clear(): void {
    instance?.clear();
  },

  /**
   * Adds a language, or replaces one: its strings, with English for any it
   * leaves out, and `dir: 'rtl'` for right-to-left. Use the code as `locale`.
   */
  registerLocale(code: string, strings: Partial<WidgetLocaleStrings>, options?: { dir?: 'ltr' | 'rtl' }): void {
    registerWidgetLocale(code, strings);
    if (options?.dir) setLanguageDirection(code, options.dir);
  },

  /**
   * The signed-in visitor: `token` for the server, `name` and `email` as
   * visitor details. Another user, or `null` to sign out, clears the chat.
   */
  setUser(user: { name?: string; email?: string; token?: string } | null): void {
    instance?.setUser(user);
  },

  /** Details the bot should know for the next messages, such as `{ plan: 'Team' }`. `null` removes them. */
  setContext(data: Record<string, string> | null): void {
    instance?.setContext(data);
  },

  /** Changes the theme, branding or wording of the running chat. What you leave out stays as it is. */
  update(changes: WidgetUpdate): void {
    instance?.update(changes);
  },

  /** The widget's version. */
  version: VERSION,

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
