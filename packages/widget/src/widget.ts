import { createShadowRoot, destroyShadowRoot } from './dom/shadow.js';
import { FAB } from './dom/fab.js';
import { Panel } from './dom/panel.js';
import { WelcomeBubble } from './dom/bubble.js';
import { ChatClient } from './api/client.js';
import { ConversationStorage } from './storage.js';
import { applyTheme } from './theme.js';
import { getWidgetLocale, type WidgetLocaleStrings } from './i18n.js';
import { PreChatForm } from './dom/prechat-form.js';
import type { MessageData } from './dom/messages.js';

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
  mode?: 'popup' | 'inline';
  container?: string | HTMLElement;
  theme?: {
    accent?: string;
    textColor?: string;
    bgColor?: string;
    fontFamily?: string;
    borderRadius?: string;
    position?: 'bottom-right' | 'bottom-left';
  };
  branding?: {
    name?: string;
    avatar?: string;
    subtitle?: string;
  };
  welcomeMessage?: string;
  welcomeBubble?: {
    text: string;
    delay?: number;
    showOnce?: boolean;
  };
  placeholder?: string;
  persistHistory?: boolean;
  maxMessages?: number;
  pageContext?: boolean;
  autoOpen?: boolean | number;
  locale?: string;
  strings?: Partial<WidgetLocaleStrings>;
  preChatForm?: PreChatFormConfig;
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (message: MessageData) => void;
  onError?: (error: Error) => void;
  onPreChatSubmit?: (data: Record<string, string>) => void;
}

type WidgetEventType = 'open' | 'close' | 'message' | 'error' | 'preChatSubmit';
type WidgetEventHandler = (...args: unknown[]) => void;

export class Widget {
  private config: WidgetConfig;
  private shadow!: ShadowRoot;
  private fab?: FAB;
  private panel!: Panel;
  private bubble?: WelcomeBubble;
  private preChatFormEl?: PreChatForm;
  private client: ChatClient;
  private storage: ConversationStorage;
  private locale: WidgetLocaleStrings;
  private conversationId: string;
  private messages: MessageData[] = [];
  private userData?: Record<string, string>;
  private userDataSent = false;
  private isStreaming = false;
  private eventHandlers = new Map<WidgetEventType, Set<WidgetEventHandler>>();
  private containerEl?: HTMLElement;

  get isInline(): boolean {
    return this.config.mode === 'inline';
  }

  constructor(config: WidgetConfig) {
    this.config = config;
    this.client = new ChatClient({ apiUrl: config.apiUrl });
    this.storage = new ConversationStorage();
    this.locale = getWidgetLocale(config.locale ?? 'en', config.strings);
    this.conversationId = this.storage.getSessionId();
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
    if (this.isInline) {
      this.containerEl = this.resolveContainer();
      this.shadow = createShadowRoot(this.containerEl);
    } else {
      this.shadow = createShadowRoot();
    }

    if (this.config.theme) {
      applyTheme(this.shadow, this.config.theme);
    }

    const position = this.config.theme?.position ?? 'bottom-right';

    // FAB — popup mode only
    if (!this.isInline) {
      this.fab = new FAB(this.shadow, {
        position,
        onClick: () => this.toggle(),
      });
    }

    this.panel = new Panel(this.shadow, {
      position,
      inline: this.isInline,
      preChatEnabled: this.config.preChatForm?.enabled ?? false,
      branding: {
        name: this.config.branding?.name ?? 'AI Assistant',
        avatar: this.config.branding?.avatar,
        subtitle: this.config.branding?.subtitle ?? 'Online',
      },
      placeholder: this.config.placeholder ?? this.locale.inputPlaceholder,
      footerText: this.locale.poweredBy,
      onSend: (text) => this.handleSend(text),
      onClose: () => this.close(),
    });

    // Restore history
    if (this.config.persistHistory !== false) {
      const saved = this.storage.load();
      if (saved) {
        this.conversationId = saved.id;
        for (const msg of saved.messages) {
          this.messages.push(msg);
          this.panel.addMessage(msg);
        }
      }
    }

    // Show pre-chat form or messages
    const shouldShowPreChat = this.config.preChatForm?.enabled
      && !this.isPreChatCompleted()
      && this.messages.length === 0;

    if (shouldShowPreChat) {
      this.showPreChatForm();
    } else {
      this.showChatView();
    }

    // Welcome bubble — popup mode only
    if (!this.isInline && this.config.welcomeBubble) {
      this.bubble = new WelcomeBubble(this.shadow, {
        text: this.config.welcomeBubble.text,
        delay: this.config.welcomeBubble.delay,
        showOnce: this.config.welcomeBubble.showOnce ?? true,
        position,
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
      setTimeout(() => this.open(), delay);
    }
  }

  open(): void {
    this.panel.show();
    if (!this.isInline) {
      this.fab?.setOpen(true);
      this.fab?.hideBadge();
      this.bubble?.hide();
    }
    this.config.onOpen?.();
    this.emit('open');
  }

  close(): void {
    this.panel.hide();
    if (!this.isInline) {
      this.fab?.setOpen(false);
    }
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

  destroy(): void {
    this.preChatFormEl?.destroy();
    this.bubble?.destroy();
    this.panel.destroy();
    this.fab?.destroy();
    destroyShadowRoot(this.containerEl);
    this.eventHandlers.clear();
    this.messages = [];
  }

  on(event: WidgetEventType, handler: WidgetEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: WidgetEventType, handler: WidgetEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  private emit(event: WidgetEventType, ...args: unknown[]): void {
    this.eventHandlers.get(event)?.forEach((h) => h(...args));
  }

  private isPreChatCompleted(): boolean {
    return this.storage.isPreChatCompleted(this.conversationId);
  }

  private setPreChatCompleted(): void {
    this.storage.setPreChatCompleted(this.conversationId);
  }

  private showPreChatForm(): void {
    const formConfig = this.config.preChatForm!;
    this.panel.hideMessages();
    this.panel.input.setVisible(false);

    this.preChatFormEl = new PreChatForm(this.panel.messagesContainer, {
      title: formConfig.title ?? this.locale.preChatTitle,
      subtitle: formConfig.subtitle ?? this.locale.preChatSubtitle,
      fields: formConfig.fields,
      submitLabel: formConfig.submitLabel ?? this.locale.preChatSubmit,
      locale: this.locale,
      onSubmit: (data) => this.handlePreChatSubmit(data),
    });
  }

  private handlePreChatSubmit(data: Record<string, string>): void {
    this.userData = data;
    this.setPreChatCompleted();

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
      const welcomeText = userName
        ? `Hi ${userName}! ${this.config.welcomeMessage ?? this.locale.welcomeMessage}`
        : (this.config.welcomeMessage ?? this.locale.welcomeMessage);
      const welcomeMsg: MessageData = {
        id: 'welcome',
        role: 'assistant',
        content: welcomeText,
      };
      this.messages.push(welcomeMsg);
      this.panel.addMessage(welcomeMsg);
    }
  }

  private async handleSend(text: string): Promise<void> {
    if (this.isStreaming) return;

    const userMsg: MessageData = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };
    this.messages.push(userMsg);
    this.panel.addMessage(userMsg);
    this.config.onMessage?.(userMsg);
    this.emit('message', userMsg);

    this.isStreaming = true;
    this.panel.input.setDisabled(true);
    this.panel.messages.showTyping();

    const assistantMsg: MessageData = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
    };

    const pageContext = this.config.pageContext !== false
      ? { url: window.location.href, title: document.title }
      : undefined;

    const includeUserData = this.userData && !this.userDataSent;

    try {
      let firstChunk = true;
      for await (const chunk of this.client.sendMessage({
        conversationId: this.conversationId,
        message: text,
        pageContext,
        locale: this.config.locale,
        ...(includeUserData ? { userData: this.userData } : {}),
      })) {
        if (chunk.error) {
          const errorKey = chunk.error === 'rate_limit' ? 'errorRateLimit'
            : chunk.error === 'network' ? 'errorNetwork'
            : 'errorGeneric';
          assistantMsg.content = this.locale[errorKey];
          this.panel.messages.removeTyping();
          this.panel.addMessage(assistantMsg);
          this.config.onError?.(new Error(chunk.error));
          this.emit('error', new Error(chunk.error));
          break;
        }

        if (chunk.done) break;

        if (chunk.content) {
          if (firstChunk) {
            this.panel.messages.removeTyping();
            this.panel.addMessage(assistantMsg);
            firstChunk = false;
          }
          assistantMsg.content += chunk.content;
          this.panel.messages.updateMessage(assistantMsg.id, assistantMsg.content, true);
        }
      }

      if (assistantMsg.content) {
        this.messages.push(assistantMsg);
        this.config.onMessage?.(assistantMsg);
        this.emit('message', assistantMsg);

        if (!this.isInline && !this.panel.isVisible) {
          this.fab?.showBadge();
        }
      }
    } catch (err) {
      this.panel.messages.removeTyping();
      assistantMsg.content = this.locale.errorGeneric;
      this.panel.addMessage(assistantMsg);
      this.config.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (includeUserData) {
        this.userDataSent = true;
      }
      this.isStreaming = false;
      this.panel.input.setDisabled(false);
      this.panel.input.focus();
      this.saveHistory();
    }
  }

  private saveHistory(): void {
    if (this.config.persistHistory === false) return;

    const maxMessages = this.config.maxMessages ?? 50;
    const toSave = this.messages.filter((m) => m.id !== 'welcome').slice(-maxMessages);

    this.storage.save({
      id: this.conversationId,
      messages: toSave.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: Date.now(),
      })),
      updatedAt: Date.now(),
    });
  }
}
