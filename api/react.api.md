# @chatcops/react public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/react`

```ts
export declare function ChatCops(props: ChatCopsProps): null;

export interface ChatCopsHandle {
    open: () => void;
    close: () => void;
    toggle: () => void;
    send: (text: string, options?: {
        open?: boolean;
    }) => Promise<void>;
    update: (changes: WidgetUpdate) => void;
}

export type ChatCopsProps = WidgetConfig & {
    onClose?: () => void;
    onError?: (error: Error) => void;
    onLeadCaptured?: (lead?: Record<string, unknown>) => void;
    onMessage?: (message: MessageData) => void;
    onOpen?: () => void;
    onPreChatSubmit?: (data: Record<string, string>) => void;
};

declare function _default(props: ChatCopsProps): null;
export { _default as default };

export interface MessageData {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status?: MessageStatus;
    errorType?: MessageErrorType;
    errorText?: string;
    sources?: Array<{
        title?: string;
        url: string;
    }>;
}

export declare function useChatCops(): ChatCopsHandle;

export interface WidgetConfig {
    apiUrl: string;
    nonce?: string;
    timeout?: number;
    turnstileSiteKey?: string;
    userToken?: UserToken;
    mode?: 'popup' | 'inline';
    siteId?: string;
    container?: string | HTMLElement;
    theme?: ThemeConfig;
    branding?: {
        avatar?: string;
        name?: string;
        subtitle?: string;
    };
    welcomeMessage?: string;
    disclosure?: false | {
        learnMoreUrl?: string;
        text?: string;
    };
    suggestions?: string[];
    welcomeBubble?: {
        delay?: number;
        showOnce?: boolean;
        text: string;
    };
    placeholder?: string;
    persistence?: Persistence;
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
    waitForConsent?: boolean;
    onConsentRequest?: () => void;
    privacyUrl?: string;
}

export type WidgetUpdate = Pick<WidgetConfig, 'branding' | 'welcomeMessage' | 'disclosure' | 'suggestions' | 'placeholder' | 'strings' | 'privacyUrl'> & {
    theme?: Omit<ThemeConfig, 'position'>;
};
```
