import { createShadowRoot, destroyShadowRoot } from './dom/shadow.js';
import { FAB } from './dom/fab.js';
import { Panel, type PanelLabels } from './dom/panel.js';
import { WelcomeBubble } from './dom/bubble.js';
import { ChatClient } from './api/client.js';
import { ConversationStorage, type Persistence } from './storage.js';
import { claimNamespace, type ClaimedNamespace } from './namespace.js';
import { applyTheme, type ThemeConfig } from './theme.js';
import { getWidgetLocale, type WidgetLocaleStrings } from './i18n.js';
import type { PreChatForm } from './dom/prechat-form.js';
import type { WidgetChatRequest } from './api/types.js';
import type { MessageData, MessageErrorType } from './dom/messages.js';

/** The locale string for each kind of failed reply. */
const ERROR_MESSAGES: Partial<Record<MessageErrorType, keyof WidgetLocaleStrings>> = {
  network: 'errorNetwork',
  timeout: 'errorNetwork',
  provider_error: 'errorGeneric',
  budget: 'errorBudget',
  budget_daily: 'errorBudgetDaily',
  unavailable: 'errorUnavailable',
  cut_off: 'errorCutOff',
};

export interface PreChatField {
  name: string;
  type: 'text' | 'email' | 'select' | 'textarea';
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
}

export interface PreChatFormConfig {
  enabled: boolean;
  title?: string;
  subtitle?: string;
  fields: PreChatField[];
  submitLabel?: string;
}

export interface WidgetConfig {
  apiUrl: string;
  /** Request/stream inactivity timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
  /**
   * Your Cloudflare Turnstile site key, when the server has `turnstile` set.
   * Cloudflare's script loads only when the widget first needs a session.
   */
  turnstileSiteKey?: string;
  /**
   * For a visitor your site has signed in: an HS256 JWT your server signs
   * with the chat server's `identity.secret` (`sub`, `exp`, optional `tier`).
   */
  userToken?: string;
  mode?: 'popup' | 'inline';
  /**
   * Names this widget's saved conversation. Set a different one on each widget
   * when a page has more than one. Without it a single widget uses the default
   * storage, and a second widget on the page is given its own automatically.
   */
  siteId?: string;
  container?: string | HTMLElement;
  theme?: ThemeConfig;
  branding?: {
    name?: string;
    avatar?: string;
    subtitle?: string;
  };
  welcomeMessage?: string;
  /**
   * The note at the top of the chat that visitors are talking to an AI, as
   * the EU AI Act asks (Article 50). On by default. `text` replaces the
   * wording, and `learnMoreUrl` adds a link. `false` turns it off, and then
   * telling visitors is up to you.
   */
  disclosure?: false | { text?: string; learnMoreUrl?: string };
  suggestions?: string[];
  welcomeBubble?: {
    text: string;
    delay?: number;
    showOnce?: boolean;
  };
  placeholder?: string;
  /**
   * Where the conversation is kept: `local` (this browser, the default),
   * `session` (this tab) or `none` (memory only, gone on reload). Nothing is
   * read or written until the chat is opened (or shown, in inline mode).
   */
  persistence?: Persistence;
  /** Saved conversations older than this are dropped. Default 30 days. */
  historyTtlDays?: number;
  maxMessages?: number;
  pageContext?: boolean;
  autoOpen?: boolean | number;
  locale?: string;
  dir?: 'ltr' | 'rtl' | 'auto';
  strings?: Partial<WidgetLocaleStrings>;
  preChatForm?: PreChatFormConfig;
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (message: MessageData) => void;
  onError?: (error: Error) => void;
  onLeadCaptured?: (leadData?: Record<string, unknown>) => void;
  onPreChatSubmit?: (data: Record<string, string>) => void;
}

/** What `update()` can change on a running chat. */
export type WidgetUpdate = Pick<
  WidgetConfig,
  'branding' | 'welcomeMessage' | 'disclosure' | 'suggestions' | 'placeholder' | 'strings'
> & { theme?: Omit<ThemeConfig, 'position'> };

/** What each widget event passes to its handlers. */
export interface WidgetEvents {
  open: [];
  close: [];
  /** A message the visitor sent, or a finished reply. */
  message: [message: MessageData];
  /** A reply that failed. */
  error: [error: Error];
  leadCaptured: [lead: Record<string, unknown> | undefined];
  preChatSubmit: [data: Record<string, string>];
}
export type WidgetEventType = keyof WidgetEvents;
/** A handler for one event, typed by it: `on('message', (message) => ...)`. */
export type WidgetEventHandler<E extends WidgetEventType = WidgetEventType> = (...args: WidgetEvents[E]) => void;
type AnyHandler = (...args: never[]) => void;
type SendRequestOptions = {
  regenerate?: boolean | { assistantMessageId: string };
  userMessageId?: string;
};

let preChatChunk: Promise<typeof import('./dom/prechat-form.js')> | undefined;

/**
 * The pre-chat form's chunk, loaded once and only by widgets that use the
 * form. A failed load is forgotten, so the next widget tries again.
 */
export function loadPreChatForm(): Promise<typeof import('./dom/prechat-form.js')> {
  preChatChunk ??= import('./dom/prechat-form.js').catch((error: unknown) => {
    preChatChunk = undefined;
    throw error;
  });
  return preChatChunk;
}

/** Starts downloading what this config will need, before the chat is shown. */
export function prefetch(config: WidgetConfig): void {
  if (config.preChatForm?.enabled) loadPreChatForm().catch(() => undefined);
}

export class Widget {
  private config: WidgetConfig;
  private shadow!: ShadowRoot;
  private mounted = false;
  private fab?: FAB;
  private panel!: Panel;
  private bubble?: WelcomeBubble;
  private preChatFormEl?: PreChatForm;
  private client: ChatClient;
  private storage: ConversationStorage;
  private namespace: ClaimedNamespace;
  private locale: WidgetLocaleStrings;
  private conversationId: string = crypto.randomUUID();
  /** The pre-chat form was submitted for this conversation. */
  private preChatDone = false;
  /** The saved conversation has been read (on first open, or at mount in inline mode). */
  private hydrated = false;
  private messages: MessageData[] = [];
  private userData?: Record<string, string>;
  private isStreaming = false;
  /** Set once the server answers in protocol v1 (0.6 and later). */
  private v1 = false;
  private destroyed = false;
  /** Goes up on newConversation() and clear(), so a reply from before is ignored. */
  private generation = 0;
  /** What the site added with setContext(), sent with every message. */
  private pageData?: Record<string, string>;
  /** The conversation the visitor details were last sent with: a v1 server keeps them from its first message. */
  private userDataSentWith?: string;
  /** Visitor details came from setUser(), so they're sent without a pre-chat form. */
  private userFromSite = false;
  private abortController?: AbortController;
  private retryRequests = new Map<string, SendRequestOptions>();
  private eventHandlers = new Map<WidgetEventType, Set<AnyHandler>>();
  private containerEl?: HTMLElement;
  private autoOpenTimer?: ReturnType<typeof setTimeout>;
  private unreadReplies = 0;
  private savedOverflow?: { value: string; priority: string };

  get isInline(): boolean {
    return this.config.mode === 'inline';
  }

  constructor(config: WidgetConfig) {
    // Checked before anything is claimed. Ignoring `persistHistory: false`
    // would save conversations on a site that asked for none.
    if ('persistHistory' in config) throw new Error("ChatCops: persistHistory was removed in 1.0. Use persistence: 'none'.");
    this.config = config;
    this.namespace = claimNamespace(
      config.siteId,
      config.mode ?? 'popup',
      () => !this.destroyed && (!this.mounted || this.shadow.host.isConnected)
    );
    const persistence = config.persistence ?? 'local';
    this.storage = new ConversationStorage(this.namespace.siteId, persistence, config.historyTtlDays);
    this.client = new ChatClient({ ...config, store: this.storage.store });
    this.locale = getWidgetLocale(config.locale ?? 'en', config.strings);
  }

  private resolveContainer(): HTMLElement {
    if (!this.config.container) {
      throw new Error('ChatCops: "container" is required when mode is "inline"');
    }
    if (typeof this.config.container === 'string') {
      const el = document.querySelector(this.config.container);
      if (!el) {
        throw new Error(`ChatCops: container element not found: ${this.config.container}`);
      }
      return el as HTMLElement;
    }
    return this.config.container;
  }

  init(): void {
    prefetch(this.config);
    if (this.isInline) {
      this.containerEl = this.resolveContainer();
      this.shadow = createShadowRoot(this.containerEl, { dir: this.config.dir, locale: this.config.locale });
    } else {
      this.shadow = createShadowRoot(undefined, { dir: this.config.dir, locale: this.config.locale });
    }
    this.mounted = true;

    if (this.config.theme) {
      applyTheme(this.shadow, this.config.theme);
    }

    const position = this.config.theme?.position ?? 'bottom-right';

    // FAB — popup mode only
    if (!this.isInline) {
      this.fab = new FAB(this.shadow, {
        position,
        openLabel: this.locale.openChat,
        closeLabel: this.locale.closeButton,
        unreadLabel: this.locale.unreadCount,
        onClick: () => this.toggle(),
      });
    }

    this.panel = new Panel(this.shadow, {
      position,
      inline: this.isInline,
      preChatEnabled: this.config.preChatForm?.enabled ?? false,
      ...this.panelLabels(),
      messageActions: {
        onRetry: (messageId) => {
          void this.handleRetry(messageId);
        },
        onRegenerate: (messageId) => {
          void this.handleRegenerate(messageId);
        },
        ...this.actionLabels(),
      },
      onSend: (text) => this.handleSend(text),
      onClose: () => this.close(),
    });

    if (this.config.disclosure === false) {
      console.info(
        "[chatcops] The AI disclosure is off (disclosure: false). Under the EU AI Act (Article 50), telling visitors they're talking to an AI is then up to you."
      );
    }
    this.renderDisclosure();

    // An inline chat is on screen from the start; a popup reads its saved
    // conversation when it's first opened, so nothing touches storage before.
    if (this.isInline) this.hydrate();

    // Welcome bubble — popup mode only
    if (!this.isInline && this.config.welcomeBubble) {
      this.bubble = new WelcomeBubble(this.shadow, {
        text: this.config.welcomeBubble.text,
        delay: this.config.welcomeBubble.delay,
        showOnce: this.config.welcomeBubble.showOnce ?? true,
        store: this.storage.store,
        position,
        dismissLabel: this.locale.dismissBubble,
        onClick: () => this.open(),
      });
    }

    // Inline mode — show panel immediately
    if (this.isInline) {
      this.panel.show();
    }

    // Auto-open — popup mode only
    if (!this.isInline && this.config.autoOpen !== undefined && this.config.autoOpen !== false) {
      const delay = typeof this.config.autoOpen === 'number' ? this.config.autoOpen : 0;
      this.autoOpenTimer = setTimeout(() => this.open(), delay);
    }
  }

  /** Reads the saved conversation and shows it, or the pre-chat form. Runs once. */
  private hydrate(): void {
    if (this.hydrated) return;
    this.hydrated = true;
    const saved = this.storage.load();
    if (saved) {
      this.conversationId = saved.id;
      this.preChatDone = saved.preChatDone ?? false;
      // Answers only count while the form is on: turning it off drops them.
      if (this.config.preChatForm?.enabled) this.userData = saved.userData;
      for (const msg of saved.messages) {
        this.messages.push(msg);
        this.panel.addMessage(msg);
      }
    }

    // A conversation that already has messages never gets the form on top of it.
    if (this.config.preChatForm?.enabled && !this.preChatDone && this.messages.length === 0) {
      this.showPreChatForm();
    } else {
      this.showChatView();
    }
    this.showLatestRegenerateButton();
  }

  open(): void {
    this.unreadReplies = 0;
    this.hydrate();
    this.panel.show();
    if (!this.isInline) {
      this.fab?.setOpen(true);
      this.bubble?.hide();
    }
    this.lockScroll();
    this.config.onOpen?.();
    this.emit('open');
  }

  close(): void {
    const hadFocus = this.panel.containsFocus();
    this.panel.hide();
    if (!this.isInline) {
      this.fab?.setOpen(false);
      if (hadFocus) this.fab?.focus();
    }
    this.restoreScroll();
    this.config.onClose?.();
    this.emit('close');
  }

  toggle(): void {
    if (this.panel.isVisible) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Sends `text` as the visitor, as if they typed it, and opens the chat
   * first unless `open: false`. Resolves when the reply has finished. A
   * message sent while a reply is still coming is ignored, as in the input.
   */
  async sendMessage(text: string, options: { open?: boolean } = {}): Promise<void> {
    if (options.open === false) this.hydrate();
    else this.open();
    await this.handleSend(text);
  }

  /**
   * Starts a fresh conversation: a new id, and the log back to the welcome
   * message. A reply that's still coming is stopped. Pre-chat answers stay.
   */
  newConversation(): void {
    this.reset(false);
  }

  /**
   * Like newConversation(), and forgets what this browser saved: the
   * transcript and the pre-chat answers, so the form shows again.
   */
  clear(): void {
    this.reset(true);
  }

  private reset(forget: boolean): void {
    this.generation++;
    this.abortController?.abort();
    this.abortController = undefined;
    this.isStreaming = false;
    this.retryRequests.clear();
    this.messages = [];
    this.conversationId = crypto.randomUUID();
    // Nothing old to restore into the new conversation.
    this.hydrated = true;
    if (forget) {
      this.userData = undefined;
      this.preChatDone = false;
      this.storage.clear();
    }
    this.preChatFormEl?.destroy();
    this.preChatFormEl = undefined;
    this.panel.messages.clear();
    this.panel.input.setDisabled(false);
    if (this.config.preChatForm?.enabled && !this.preChatDone) this.showPreChatForm();
    else this.showChatView();
    if (!forget) this.saveHistory();
  }

  /**
   * The signed-in visitor. `token` is the identity token for the server
   * (signed-in visitors); `name` and `email` are sent as visitor details, and
   * the name greets them. Switching to another user, or signing out with
   * `null`, clears the chat, so one person's conversation never shows for
   * the next.
   */
  setUser(user: { name?: string; email?: string; token?: string } | null): void {
    const previous = this.client.identity;
    const token = user?.token;
    if (previous !== undefined && previous !== token) this.clear();
    this.client.setUserToken(token);
    if (!user) return;
    const details = Object.fromEntries(
      Object.entries({ name: user.name, email: user.email }).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    );
    if (Object.keys(details).length) {
      this.userData = { ...this.userData, ...details };
      this.userFromSite = true;
    }
  }

  /**
   * Details about the page or the visitor that the bot should know for the
   * next messages, such as `{ plan: 'Team' }`. Sent with each message as
   * page context; `null` removes them. Ignored when `pageContext: false`.
   */
  setContext(data: Record<string, string> | null): void {
    this.pageData = data && Object.keys(data).length ? { ...data } : undefined;
  }

  /**
   * Changes the look or wording of the running chat without loading it
   * again: the theme (not `position`), branding, strings, placeholder,
   * disclosure, welcome message and suggestions. What you leave out stays
   * as it is. A conversation that has only the welcome message shows the
   * new one; otherwise the welcome message and suggestions are for the
   * next conversation.
   */
  update(changes: WidgetUpdate): void {
    const current = this.config;
    const theme = { ...current.theme, ...changes.theme, position: current.theme?.position };
    this.config = {
      ...current,
      ...changes,
      theme,
      branding: { ...current.branding, ...changes.branding },
      strings: { ...current.strings, ...changes.strings },
    };
    this.locale = getWidgetLocale(this.config.locale ?? 'en', this.config.strings);
    if (!this.mounted) return;
    if (changes.theme) applyTheme(this.shadow, theme);
    const l = this.locale;
    this.fab?.setLabels(l.openChat, l.closeButton, l.unreadCount);
    this.panel.update(this.panelLabels(), this.actionLabels());
    this.renderDisclosure();
    if (this.messages.length === 1 && this.messages[0].id === 'welcome') {
      this.messages = [];
      this.panel.messages.clear();
      this.showChatView();
    }
  }

  private panelLabels(): PanelLabels {
    const { branding, placeholder } = this.config;
    const l = this.locale;
    return {
      branding: {
        name: branding?.name ?? l.defaultName,
        avatar: branding?.avatar,
        subtitle: branding?.subtitle ?? l.defaultSubtitle,
      },
      placeholder: placeholder ?? l.inputPlaceholder,
      footerText: l.poweredBy,
      closeLabel: l.closeButton,
      sendLabel: l.sendButton,
    };
  }

  private actionLabels() {
    const l = this.locale;
    return {
      retryLabel: l.retryButton,
      regenerateLabel: l.regenerateButton,
      typingLabel: l.typingIndicator,
      sourcesLabel: l.sourcesLabel,
    };
  }

  private renderDisclosure(): void {
    const { disclosure } = this.config;
    if (disclosure === false) this.panel.messages.setDisclosure();
    else
      this.panel.messages.setDisclosure(
        disclosure?.text ?? this.locale.disclosure,
        disclosure?.learnMoreUrl ? { url: disclosure.learnMoreUrl, label: this.locale.disclosureLearnMore } : undefined
      );
  }

  private isStale(generation: number): boolean {
    return this.destroyed || generation !== this.generation;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.autoOpenTimer !== undefined) clearTimeout(this.autoOpenTimer);
    this.abortController?.abort();
    this.abortController = undefined;
    this.restoreScroll();
    this.preChatFormEl?.destroy();
    this.bubble?.destroy();
    this.panel.destroy();
    this.fab?.destroy();
    destroyShadowRoot(this.shadow);
    this.namespace.release();
    this.eventHandlers.clear();
    this.messages = [];
    this.userData = undefined;
  }

  private lockScroll(): void {
    if (this.savedOverflow !== undefined || this.isInline) return;
    // Keep this breakpoint synchronized with @media (max-width: 640px) in packages/widget/src/styles/widget.css
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 640px)')?.matches) {
      const root = document.documentElement;
      this.savedOverflow = {
        value: root.style.getPropertyValue('overflow'),
        priority: root.style.getPropertyPriority('overflow'),
      };
      root.style.setProperty('overflow', 'hidden');
    }
  }

  private restoreScroll(): void {
    if (this.savedOverflow === undefined) return;
    const { value, priority } = this.savedOverflow;
    if (value) {
      document.documentElement.style.setProperty('overflow', value, priority);
    } else {
      document.documentElement.style.removeProperty('overflow');
    }
    this.savedOverflow = undefined;
  }

  on<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as AnyHandler);
    return () => this.off(event, handler);
  }

  off<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): void {
    this.eventHandlers.get(event)?.delete(handler as AnyHandler);
  }

  private emit<E extends WidgetEventType>(event: E, ...args: WidgetEvents[E]): void {
    if (this.destroyed) return;
    this.eventHandlers.get(event)?.forEach((h) => {
      (h as WidgetEventHandler<E>)(...args);
    });
  }

  private showPreChatForm(): void {
    const formConfig = this.config.preChatForm!;
    this.panel.hideMessages();
    this.panel.input.setVisible(false);

    loadPreChatForm().then(
      ({ PreChatForm }) => {
        // Destroyed, or the visitor sent a message, while the form loaded.
        if (this.destroyed || this.preChatDone || this.preChatFormEl) return;
        this.preChatFormEl = new PreChatForm(this.panel.messagesContainer, {
          title: formConfig.title ?? this.locale.preChatTitle,
          subtitle: formConfig.subtitle ?? this.locale.preChatSubtitle,
          fields: formConfig.fields,
          submitLabel: formConfig.submitLabel ?? this.locale.preChatSubmit,
          locale: this.locale,
          onSubmit: (data) => this.handlePreChatSubmit(data),
        });
      },
      (error: unknown) => {
        // Without the form the chat still works, just with no answers.
        console.error('[chatcops] The pre-chat form could not load:', error instanceof Error ? error.message : error);
        if (this.destroyed || this.preChatDone) return;
        this.preChatDone = true;
        this.panel.showMessages();
        this.panel.input.setVisible(true);
        this.showChatView();
      }
    );
  }

  private handlePreChatSubmit(data: Record<string, string>): void {
    if (!this.config.preChatForm?.enabled) return;
    this.hydrate();
    this.userData = data;
    this.preChatDone = true;
    this.saveHistory();

    this.preChatFormEl?.destroy();
    this.preChatFormEl = undefined;

    this.panel.showMessages();
    this.panel.input.setVisible(true);

    this.showChatView();

    this.config.onPreChatSubmit?.(data);
    this.emit('preChatSubmit', data);

    if (data.message) {
      this.handleSend(data.message);
    }
  }

  private showChatView(): void {
    if (this.messages.length === 0) {
      const userName = this.userData?.name;
      const greeting = this.locale.greetingWithName.replace('{name}', () => userName!);
      const welcomeText = userName
        ? `${greeting} ${this.config.welcomeMessage ?? this.locale.welcomeMessage}`
        : (this.config.welcomeMessage ?? this.locale.welcomeMessage);
      const welcomeMsg: MessageData = {
        id: 'welcome',
        role: 'assistant',
        content: welcomeText,
      };
      this.messages.push(welcomeMsg);
      this.panel.addMessage(welcomeMsg);
      this.renderSuggestions();
    }
  }

  private renderSuggestions(suggestions: string[] = this.config.suggestions ?? []): void {
    if (this.messages.some((message) => message.role === 'user')) return;
    this.panel.messages.showSuggestions(
      suggestions,
      this.locale.suggestionsLabel,
      (suggestion) => { void this.handleSend(suggestion); }
    );
  }

  private async handleSend(text: string): Promise<void> {
    if (this.isStreaming) return;
    // A message sent before the chat was opened still joins the saved conversation.
    this.hydrate();

    const userMsg: MessageData = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    this.messages.push(userMsg);
    this.panel.addMessage(userMsg);
    this.config.onMessage?.(userMsg);
    this.emit('message', userMsg);

    await this.sendToServer(text, { userMessageId: userMsg.id });
  }

  private async handleRetry(errorMessageId: string): Promise<void> {
    if (this.isStreaming) return;

    const errorIndex = this.messages.findIndex((message) => message.id === errorMessageId);
    if (errorIndex === -1) return;

    const retryRequest = this.retryRequests.get(errorMessageId);
    let userMessage = retryRequest?.userMessageId
      ? this.messages.find((message) => message.id === retryRequest.userMessageId)
      : undefined;

    if (!userMessage) {
      for (let i = errorIndex - 1; i >= 0; i--) {
        if (this.messages[i].role === 'user') {
          userMessage = this.messages[i];
          break;
        }
      }
    }

    if (!userMessage) return;

    this.panel.messages.removeMessage(errorMessageId);
    this.retryRequests.delete(errorMessageId);
    this.messages = this.messages.filter((message) => message.id !== errorMessageId);

    await this.sendToServer(userMessage.content, {
      regenerate: retryRequest?.regenerate,
      userMessageId: retryRequest?.userMessageId ?? userMessage.id,
    });
  }

  private async handleRegenerate(assistantMessageId: string): Promise<void> {
    if (this.isStreaming) return;

    const assistantIndex = this.messages.findIndex((message) => message.id === assistantMessageId);
    if (assistantIndex === -1) return;

    const assistantMessage = this.messages[assistantIndex];
    if (assistantMessage.role !== 'assistant') return;

    const userMessage = this.findUserMessageForAssistant(assistantIndex);
    if (!userMessage) return;

    this.panel.messages.clearRegenerateButtons();
    this.panel.messages.removeMessage(assistantMessageId);
    this.retryRequests.delete(assistantMessageId);
    this.messages = this.messages.filter((message) => message.id !== assistantMessageId);

    await this.sendToServer(userMessage.content, {
      // A v1 server saved the reply under this id; a 0.5 server only knows `true`.
      regenerate: this.v1 ? { assistantMessageId } : true,
      userMessageId: userMessage.id,
    });
  }

  private async sendToServer(text: string, options: SendRequestOptions = {}): Promise<void> {
    if (this.isStreaming) return;
    // A reply that's still running when the conversation is reset writes nothing to the new one.
    const generation = this.generation;

    this.isStreaming = true;
    this.panel.input.setDisabled(true);
    this.panel.messages.clearRegenerateButtons();
    this.panel.messages.beginReply();
    this.panel.messages.showTyping();

    const assistantMsg: MessageData = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      status: 'streaming',
      sources: [],
    };

    let firstChunk = true;
    let requestCompleted = false;
    let hasError = false;

    const abortController = new AbortController();
    this.abortController = abortController;

    try {
      for await (const chunk of this.client.sendMessage(
        this.createRequest(text, options),
        { signal: abortController.signal }
      )) {
        if (this.isStale(generation)) break;
        if (chunk.error) {
          const errorType = this.resolveErrorType(chunk.error);
          this.markFailed(assistantMsg, this.getErrorMessage(errorType, chunk.retryAfterMs));
          assistantMsg.errorType = errorType;
          hasError = true;

          this.retryRequests.set(assistantMsg.id, {
            regenerate: options.regenerate,
            userMessageId: options.userMessageId,
          });

          this.panel.messages.removeTyping();
          if (firstChunk) {
            this.panel.addMessage(assistantMsg);
          } else {
            this.panel.messages.updateMessage(assistantMsg);
          }

          this.messages.push(assistantMsg);

          const error = new Error(chunk.error);
          this.config.onError?.(error);
          this.emit('error', error);
          break;
        }

        if (chunk.done) {
          requestCompleted = true;
          break;
        }

        if (chunk.conversationId) this.conversationId = chunk.conversationId;

        // The reply is saved under the server's id, so regenerate can name it.
        if (chunk.messageId) {
          assistantMsg.id = chunk.messageId;
          this.v1 = true;
        }

        if (chunk.leadCaptured) {
          this.config.onLeadCaptured?.(chunk.leadData);
          this.emit('leadCaptured', chunk.leadData);
        }

        if (chunk.source) {
          assistantMsg.sources ??= [];
          assistantMsg.sources.push(chunk.source);
        }

        if (chunk.content) {
          if (firstChunk) {
            this.panel.messages.removeTyping();
            this.panel.addMessage(assistantMsg);
            firstChunk = false;
          }

          assistantMsg.content += chunk.content;
          this.panel.messages.updateMessage(assistantMsg);
        }
      }

      if (this.isStale(generation)) return;

      if (!hasError && !requestCompleted) {
        requestCompleted = true;
      }

      if (!hasError && firstChunk) {
        this.panel.messages.removeTyping();
      }

      if (!hasError && assistantMsg.content) {
        assistantMsg.status = 'complete';
        this.panel.messages.updateMessage(assistantMsg);
        this.messages.push(assistantMsg);
        this.config.onMessage?.(assistantMsg);
        this.emit('message', assistantMsg);
        this.showLatestRegenerateButton();

        if (!this.isInline && !this.panel.isVisible) {
          this.unreadReplies++;
          this.fab?.showBadge(this.unreadReplies);
        }
      }
    } catch (err) {
      if (this.isStale(generation)) return;

      this.markFailed(assistantMsg, this.locale.errorGeneric);
      assistantMsg.errorType = 'network';

      this.retryRequests.set(assistantMsg.id, {
        regenerate: options.regenerate,
        userMessageId: options.userMessageId,
      });

      this.panel.messages.removeTyping();
      // The bubble already exists if some of the reply streamed before the failure.
      if (firstChunk) {
        this.panel.addMessage(assistantMsg);
      } else {
        this.panel.messages.updateMessage(assistantMsg);
      }
      this.messages.push(assistantMsg);

      const error = err instanceof Error ? err : new Error(String(err));
      this.config.onError?.(error);
      this.emit('error', error);
    } finally {
      if (this.abortController === abortController) {
        this.abortController = undefined;
      }

      if (!this.isStale(generation)) {
        this.panel.messages.finishReply(assistantMsg);
        this.isStreaming = false;
        this.panel.input.setDisabled(false);
        this.panel.input.focus();
        this.saveHistory();
      }
    }
  }

  private createRequest(
    text: string,
    options: SendRequestOptions
  ): WidgetChatRequest {
    const pageContext = this.config.pageContext !== false
      ? { url: window.location.href, title: document.title, ...(this.pageData ? { data: this.pageData } : {}) }
      : undefined;

    // A v1 server keeps the details from a conversation's first message; 0.5 servers need them every time.
    const includeUserData = Boolean(
      (this.config.preChatForm?.enabled || this.userFromSite) &&
        this.userData &&
        (!this.v1 || this.userDataSentWith !== this.conversationId)
    );
    if (includeUserData) this.userDataSentWith = this.conversationId;

    return {
      conversationId: this.conversationId,
      message: text,
      messageId: options.userMessageId,
      regenerate: options.regenerate,
      pageContext,
      locale: this.config.locale,
      ...(includeUserData ? { userData: this.userData } : {}),
    };
  }

  private findUserMessageForAssistant(assistantIndex: number): MessageData | undefined {
    for (let i = assistantIndex - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        return this.messages[i];
      }
    }

    return undefined;
  }

  private findLatestRegeneratableAssistant(): MessageData | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (message.id === 'welcome') {
        continue;
      }

      if (message.role !== 'assistant' || message.status === 'error') {
        return undefined;
      }

      return message;
    }

    return undefined;
  }

  private showLatestRegenerateButton(): void {
    const assistantMessage = this.findLatestRegeneratableAssistant();
    if (assistantMessage) {
      this.panel.messages.showRegenerateButton(assistantMessage.id);
    } else {
      this.panel.messages.clearRegenerateButtons();
    }
  }

  private resolveErrorType(error: string): MessageErrorType {
    return error in ERROR_MESSAGES || error === 'rate_limit' ? (error as MessageErrorType) : 'provider_error';
  }

  /**
   * Marks a reply as failed. Text that already streamed stays, and the error
   * shows as a note under it; an empty reply shows the error as its content.
   */
  private markFailed(message: MessageData, errorMessage: string): void {
    message.status = 'error';
    if (message.content.trim()) {
      message.errorText = errorMessage;
    } else {
      message.content = errorMessage;
    }
  }

  private getErrorMessage(errorType: MessageErrorType, retryAfterMs?: number): string {
    if (errorType === 'rate_limit') {
      return retryAfterMs
        ? this.locale.errorRateLimitWait.replace('{seconds}', String(Math.ceil(retryAfterMs / 1000)))
        : this.locale.errorRateLimit;
    }
    return this.locale[ERROR_MESSAGES[errorType] ?? 'errorGeneric'];
  }

  private saveHistory(): void {
    const maxMessages = this.config.maxMessages ?? 50;
    const toSave = this.messages.filter((m) => m.id !== 'welcome').slice(-maxMessages);

    this.storage.save({
      id: this.conversationId,
      messages: toSave.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        status: m.status,
        errorType: m.errorType,
        timestamp: Date.now(),
        ...(m.sources && m.sources.length > 0 ? { sources: m.sources } : {}),
      })),
      ...(this.userData ? { userData: this.userData } : {}),
      ...(this.preChatDone ? { preChatDone: true } : {}),
      updatedAt: Date.now(),
    });
  }
}
