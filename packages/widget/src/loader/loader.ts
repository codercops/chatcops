import launcherStyles from '../styles/launcher.css?inline';
import { CHAT_ICON } from '../dom/icons.js';
import { HOST_ID, nextHostId, resolveDirection, setLanguageDirection } from '../dom/shadow.js';
import { applyTheme } from '../theme.js';
import type { WidgetLocaleStrings } from '../i18n.js';
import type { Widget, WidgetConfig, WidgetEventHandler, WidgetEventType } from '../widget.js';
import { VERSION } from '../version.js';

export interface PanelModule {
  Widget: typeof Widget;
  /** Starts loading what the config needs (the pre-chat form's chunk). */
  prefetch?: (config: WidgetConfig) => void;
}

/** `window.ChatCops` in the script tag build. */
export interface ChatCopsLoader {
  /** Shows the launcher, and loads the chat the first time it's needed. */
  init(config: WidgetConfig): void;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
  on<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): () => void;
  off<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): void;
  /** Sends `text` as the visitor, loading and opening the chat first (unless `open: false`). */
  sendMessage(text: string, options?: { open?: boolean }): Promise<void>;
  /** A fresh conversation: new id, the log back to the welcome message. */
  newConversation(): void;
  /** A fresh conversation, and the saved transcript and pre-chat answers removed from this browser. */
  clear(): void;
  /** Adds or replaces a language for `locale`: its strings (English for any left out), and `dir`. */
  registerLocale(code: string, strings: Partial<WidgetLocaleStrings>, options?: { dir?: 'ltr' | 'rtl' }): void;
  /** The signed-in visitor (token, name, email). Another user, or `null`, clears the chat. Kept until the chat loads. */
  setUser(user: { name?: string; email?: string; token?: string } | null): void;
  /** Details the bot should know for the next messages. `null` removes them. Kept until the chat loads. */
  setContext(data: Record<string, string> | null): void;
  /** The widget's version. */
  readonly version: string;
}

const DEFAULT_BUBBLE_DELAY = 3000;

/** A translation file in `dist/locales/`: the widget's strings for one language. */
export interface LocaleModule {
  default: Partial<WidgetLocaleStrings>;
}

/**
 * Where a language's strings are: `locales/<language>.js` next to the panel,
 * by the language part of the code (`pt-BR` loads `pt`). English is built in,
 * so it has no file.
 */
export function localeUrlFor(panelUrl: string, locale: string): string | undefined {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  if (language === 'en' || !/^[a-z]{2,3}$/.test(language)) return undefined;
  const panel = new URL(panelUrl);
  const url = new URL(`locales/${language}.js`, panel);
  url.search = panel.search;
  return url.href;
}

/**
 * Where the panel is, given the loader's own URL: next to the file
 * (`…/dist/chatcops.min.js` or a renamed copy), or in the package's `dist/`
 * when the page loads the bare package URL that CDNs resolve to the main
 * file (`https://cdn.jsdelivr.net/npm/@chatcops/widget@0.7`).
 */
export function panelUrlFor(loaderUrl: string, version: string): string {
  const url = new URL(loaderUrl);
  const base = /\.m?js$/.test(url.pathname) ? url.href : `${url.origin}${url.pathname.replace(/\/$/, '')}/dist/`;
  const panel = new URL('chatcops.panel.js', base);
  panel.searchParams.set('v', version);
  return panel.href;
}

/**
 * The script tag build: a small launcher that looks like the chat button and
 * loads the full chat (`loadPanel`) when the visitor opens it, or earlier when
 * the page asks for it (`open()`, `autoOpen`, a welcome bubble, inline mode).
 * Hovering or focusing the launcher starts the download, so the click rarely
 * waits. Nothing here touches storage or the network before that.
 *
 * `loadLocale` fetches the strings for `config.locale` alongside the panel.
 * If they can't load, the chat opens in English.
 */
export function createLoader(
  loadPanel: () => Promise<PanelModule>,
  loadLocale: (locale: string) => Promise<LocaleModule> | undefined = () => undefined
): ChatCopsLoader {
  let config: WidgetConfig | undefined;
  let widget: Widget | undefined;
  let loading: Promise<Widget | undefined> | undefined;
  let launcher: HTMLElement | undefined;
  let button: HTMLButtonElement | undefined;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const handlers = new Map<WidgetEventType, Set<WidgetEventHandler<never>>>();
  const locales = new Map<string, Promise<Partial<WidgetLocaleStrings> | undefined>>();
  /** Languages the page registered: no file to fetch, and their direction passed to the panel. */
  const registered = new Map<string, { strings: Partial<WidgetLocaleStrings>; dir?: 'ltr' | 'rtl' }>();
  // setUser() and setContext() before the chat loads: applied when it does,
  // so a signed-in page doesn't load the chat early.
  let user: Parameters<ChatCopsLoader['setUser']>[0] | undefined;
  let context: Record<string, string> | null | undefined;
  const directionOf = (current: WidgetConfig) => current.dir ?? (current.locale ? registered.get(current.locale)?.dir : undefined);

  /** The translated strings for a config, loaded once per locale. */
  function strings(current: WidgetConfig): Promise<Partial<WidgetLocaleStrings> | undefined> {
    const code = current.locale;
    if (!code) return Promise.resolve(undefined);
    const own = registered.get(code);
    if (own) return Promise.resolve(own.strings);
    let found = locales.get(code);
    if (!found) {
      found = Promise.resolve(loadLocale(code)).then(
        (module) => (module && typeof module.default === 'object' ? module.default : undefined),
        (error: unknown) => {
          locales.delete(code);
          console.warn(`[chatcops] The "${code}" strings could not load, so the chat is in English:`, error instanceof Error ? error.message : error);
          return undefined;
        }
      );
      locales.set(code, found);
    }
    return found;
  }

  /**
   * Loads the chat and swaps it in for the launcher. The loader already
   * handled `autoOpen` and the bubble's delay, so the widget only gets a
   * bubble when it's mounted to show one.
   */
  function mount(overrides: Partial<WidgetConfig> = { welcomeBubble: undefined }): Promise<Widget | undefined> {
    const current = config;
    if (!current) return Promise.resolve(undefined);
    loading ??= Promise.all([loadPanel(), strings(current)]).then(
      ([panel, translated]) => {
        // Destroyed, or initialized again, while the chat was loading.
        if (config !== current) return undefined;
        const next = new panel.Widget({
          ...current,
          // The site's own strings win over the translation.
          strings: translated ? { ...translated, ...current.strings } : current.strings,
          ...(directionOf(current) ? { dir: directionOf(current) } : {}),
          autoOpen: undefined,
          ...overrides,
        });
        for (const [event, set] of handlers) {
          for (const handler of set) next.on(event, handler as WidgetEventHandler);
        }
        // Swapped in one task, so the page never paints without a button.
        launcher?.remove();
        launcher = button = undefined;
        next.init();
        if (user !== undefined) next.setUser(user);
        if (context !== undefined) next.setContext(context);
        widget = next;
        return next;
      },
      (error: unknown) => {
        loading = undefined;
        console.error('[chatcops] The chat could not load:', error instanceof Error ? error.message : error);
        if (button && config) {
          const label = config.strings?.errorNetwork ?? 'Connection error. Please check your network.';
          button.setAttribute('aria-label', label);
          button.title = label;
          button.dataset.state = 'error';
        }
        return undefined;
      }
    );
    return loading;
  }

  function showLauncher(current: WidgetConfig): void {
    launcher = document.createElement('div');
    launcher.id = nextHostId();
    launcher.className = HOST_ID;
    launcher.dir = resolveDirection(directionOf(current), current.locale);
    document.body.appendChild(launcher);
    const shadow = launcher.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = launcherStyles;
    shadow.appendChild(style);
    if (current.theme) applyTheme(shadow, current.theme);

    button = document.createElement('button');
    button.className = 'cc-fab cc-pulse';
    if (current.theme?.position === 'bottom-left') button.classList.add('cc-left');
    button.setAttribute('aria-label', current.strings?.openChat ?? 'Open chat');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = CHAT_ICON;
    const prefetch = () => {
      void strings(current);
      void loadPanel().then(
        (panel) => panel.prefetch?.(current),
        () => undefined
      );
    };
    button.addEventListener('pointerenter', prefetch, { once: true });
    button.addEventListener('focus', prefetch, { once: true });
    button.addEventListener('click', () => api.open());
    shadow.appendChild(button);
  }

  const api: ChatCopsLoader = {
    init(next) {
      api.destroy();
      config = next;
      if (next.mode === 'inline') {
        void mount();
        return;
      }
      showLauncher(next);
      if (next.autoOpen !== undefined && next.autoOpen !== false) {
        timers.push(setTimeout(() => api.open(), next.autoOpen === true ? 0 : next.autoOpen));
      }
      if (next.welcomeBubble) {
        // The chat loads when the bubble is due, and shows it right away.
        const bubble = next.welcomeBubble;
        timers.push(setTimeout(() => void mount({ welcomeBubble: { ...bubble, delay: 0 } }), bubble.delay ?? DEFAULT_BUBBLE_DELAY));
      }
    },

    open() {
      void mount().then((ready) => ready?.open());
    },

    close() {
      widget?.close();
    },

    toggle() {
      if (widget) widget.toggle();
      else api.open();
    },

    sendMessage(text, options) {
      return mount().then((ready) => ready?.sendMessage(text, options));
    },

    newConversation() {
      void mount().then((ready) => ready?.newConversation());
    },

    clear() {
      void mount().then((ready) => ready?.clear());
    },

    registerLocale(code, strings, options) {
      registered.set(code, { strings, ...(options?.dir ? { dir: options.dir } : {}) });
      if (options?.dir) setLanguageDirection(code, options.dir);
    },

    setUser(next) {
      user = next;
      widget?.setUser(next);
    },

    setContext(next) {
      context = next;
      widget?.setContext(next);
    },

    version: VERSION,

    destroy() {
      for (const timer of timers.splice(0)) clearTimeout(timer);
      launcher?.remove();
      launcher = button = undefined;
      widget?.destroy();
      widget = undefined;
      loading = undefined;
      config = undefined;
    },

    on(event, handler) {
      let set = handlers.get(event);
      if (!set) {
        set = new Set();
        handlers.set(event, set);
      }
      set.add(handler as WidgetEventHandler<never>);
      widget?.on(event, handler);
      return () => api.off(event, handler);
    },

    off(event, handler) {
      handlers.get(event)?.delete(handler as WidgetEventHandler<never>);
      widget?.off(event, handler);
    },
  };
  return api;
}
