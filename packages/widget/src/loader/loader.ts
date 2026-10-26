import launcherStyles from '../styles/launcher.css?inline';
import { CHAT_ICON } from '../dom/icons.js';
import { HOST_ID, nextHostId } from '../dom/shadow.js';
import { applyTheme } from '../theme.js';
import type { Widget, WidgetConfig, WidgetEventHandler, WidgetEventType } from '../widget.js';

export interface PanelModule {
  Widget: typeof Widget;
}

/** `window.ChatCops` in the script tag build. */
export interface ChatCopsLoader {
  /** Shows the launcher, and loads the chat the first time it's needed. */
  init(config: WidgetConfig): void;
  open(): void;
  close(): void;
  destroy(): void;
  on<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): () => void;
  off<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): void;
}

const DEFAULT_BUBBLE_DELAY = 3000;

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
 */
export function createLoader(loadPanel: () => Promise<PanelModule>): ChatCopsLoader {
  let config: WidgetConfig | undefined;
  let widget: Widget | undefined;
  let loading: Promise<Widget | undefined> | undefined;
  let launcher: HTMLElement | undefined;
  let button: HTMLButtonElement | undefined;
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  const handlers = new Map<WidgetEventType, Set<WidgetEventHandler<never>>>();

  /**
   * Loads the chat and swaps it in for the launcher. The loader already
   * handled `autoOpen` and the bubble's delay, so the widget only gets a
   * bubble when it's mounted to show one.
   */
  function mount(overrides: Partial<WidgetConfig> = { welcomeBubble: undefined }): Promise<Widget | undefined> {
    const current = config;
    if (!current) return Promise.resolve(undefined);
    loading ??= loadPanel().then(
      (panel) => {
        // Destroyed, or initialized again, while the chat was loading.
        if (config !== current) return undefined;
        const next = new panel.Widget({ ...current, autoOpen: undefined, ...overrides });
        for (const [event, set] of handlers) {
          for (const handler of set) next.on(event, handler as WidgetEventHandler);
        }
        // Swapped in one task, so the page never paints without a button.
        launcher?.remove();
        launcher = button = undefined;
        next.init();
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
    const prefetch = () => void loadPanel().catch(() => undefined);
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
