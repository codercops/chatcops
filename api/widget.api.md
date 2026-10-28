# @chatcops/widget public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/widget`

```ts
declare const _default: {
    init(config: WidgetConfig): Widget;
    open(): void;
    close(): void;
    toggle(): void;
    sendMessage(text: string, options?: {
        open?: boolean;
    }): Promise<void>;
    newConversation(): void;
    clear(): void;
    registerLocale(code: string, strings: Partial<WidgetLocaleStrings>, options?: {
        dir?: "ltr" | "rtl";
    }): void;
    setUser(user: {
        name?: string;
        email?: string;
        token?: string;
    } | null): void;
    setContext(data: Record<string, string> | null): void;
    update(changes: WidgetUpdate): void;
    version: string;
    destroy(): void;
    on<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): () => void;
    off<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): void;
};
export { _default as default };

export interface MessageData {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status?: MessageStatus;
    errorType?: MessageErrorType;
    errorText?: string;
    sources?: Array<{
        url: string;
        title?: string;
    }>;
}

export declare function parseAutoOpen(value?: string): boolean | number | undefined;

export declare class Widget {
    get isInline(): boolean;
    constructor(config: WidgetConfig);
    init(): void;
    open(): void;
    close(): void;
    toggle(): void;
    sendMessage(text: string, options?: {
        open?: boolean;
    }): Promise<void>;
    newConversation(): void;
    clear(): void;
    setUser(user: {
        name?: string;
        email?: string;
        token?: string;
    } | null): void;
    setContext(data: Record<string, string> | null): void;
    update(changes: WidgetUpdate): void;
    destroy(): void;
    on<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): () => void;
    off<E extends WidgetEventType>(event: E, handler: WidgetEventHandler<E>): void;
}

export interface WidgetConfig {
    apiUrl: string;
    timeout?: number;
    turnstileSiteKey?: string;
    userToken?: string;
    mode?: 'popup' | 'inline';
    siteId?: string;
    container?: string | HTMLElement;
    theme?: ThemeConfig;
    branding?: {
        name?: string;
        avatar?: string;
        subtitle?: string;
    };
    welcomeMessage?: string;
    disclosure?: false | {
        text?: string;
        learnMoreUrl?: string;
    };
    suggestions?: string[];
    welcomeBubble?: {
        text: string;
        delay?: number;
        showOnce?: boolean;
    };
    placeholder?: string;
    persistence?: Persistence;
    historyTtlDays?: number;
    persistHistory?: boolean;
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

export type WidgetEventHandler<E extends WidgetEventType = WidgetEventType> = (...args: WidgetEvents[E]) => void;

export interface WidgetEvents {
    open: [
    ];
    close: [
    ];
    message: [
        message: MessageData
    ];
    error: [
        error: Error
    ];
    leadCaptured: [
        lead: Record<string, unknown> | undefined
    ];
    preChatSubmit: [
        data: Record<string, string>
    ];
}

export type WidgetEventType = keyof WidgetEvents;

export interface WidgetLocaleStrings {
    welcomeMessage: string;
    inputPlaceholder: string;
    sendButton: string;
    closeButton: string;
    openChat: string;
    defaultName: string;
    defaultSubtitle: string;
    greetingWithName: string;
    selectPlaceholder: string;
    dismissBubble: string;
    errorGeneric: string;
    errorNetwork: string;
    errorRateLimit: string;
    errorRateLimitWait: string;
    errorBudget: string;
    errorBudgetDaily: string;
    errorUnavailable: string;
    errorCutOff: string;
    typingIndicator: string;
    poweredBy: string;
    newConversation: string;
    welcomeBubbleDefault: string;
    preChatTitle: string;
    preChatSubtitle: string;
    preChatSubmit: string;
    preChatRequired: string;
    preChatInvalidEmail: string;
    retryButton: string;
    regenerateButton: string;
    suggestionsLabel: string;
    unreadCount: string;
    sourcesLabel: string;
    disclosure: string;
    disclosureLearnMore: string;
}

export type WidgetUpdate = Pick<WidgetConfig, 'branding' | 'welcomeMessage' | 'disclosure' | 'suggestions' | 'placeholder' | 'strings'> & {
    theme?: Omit<ThemeConfig, 'position'>;
};
```

## `@chatcops/widget/locales/*`

The same for each of: `ar`, `de`, `es`, `fr`, `he`, `hi`, `it`, `ja`, `ko`, `nl`, `pt`, `ur`, `zh`.

```ts
declare const _default: Partial<WidgetLocaleStrings>;
export { _default as default };
```

## Types no entry exports

They're part of the API above all the same: a change to one is a change to the API.

```ts
type MessageErrorType = 'rate_limit' | 'network' | 'provider_error' | 'timeout' | 'budget' | 'budget_daily' | 'unavailable' | 'cut_off';

type MessageStatus = 'streaming' | 'complete' | 'error';

type Persistence = 'none' | 'session' | 'local';

interface PreChatField {
    name: string;
    type: 'text' | 'email' | 'select' | 'textarea';
    label: string;
    placeholder?: string;
    required?: boolean;
    options?: string[];
}

interface PreChatFormConfig {
    enabled: boolean;
    title?: string;
    subtitle?: string;
    fields: PreChatField[];
    submitLabel?: string;
}

interface ThemeConfig {
    mode?: ThemeMode;
    accent?: string;
    accentDark?: string;
    textColor?: string;
    bgColor?: string;
    fontFamily?: string;
    borderRadius?: string | number;
    position?: 'bottom-right' | 'bottom-left';
}

type ThemeMode = 'light' | 'dark' | 'auto';
```
