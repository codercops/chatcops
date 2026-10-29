# @chatcops/server public API

Made by `node scripts/api-snapshot.mjs` from the built types. Don't edit it by hand: change the code, build, and run the script again.

## `@chatcops/server`

```ts
export declare function assertSafeWebhookUrl(rawUrl: string, allowPrivateNetwork?: boolean): URL;

export declare function chatcopsAiSdkHandler(config: ChatCopsServerConfig): (req: Request) => Promise<Response>;

export declare function chatcopsAnalyticsHandler(config: ChatCopsServerConfig): (req: Request, res: Response) => Promise<void>;

export declare function chatcopsCloudflareHandler(config: ChatCopsServerConfig): (request: Request, _env?: unknown, ctx?: {
    waitUntil?(promise: Promise<unknown>): void;
}) => Promise<Response>;

export declare function chatcopsMiddleware(config: ChatCopsServerConfig): (req: Request, res: Response, _next: NextFunction) => Promise<void>;

export interface ChatCopsServerConfig {
    provider: ProviderConfig | AIProvider;
    systemPrompt: string;
    logger?: Logger;
    tools?: ChatTool[];
    toolTimeoutMs?: number;
    maxTokens?: number;
    temperature?: number;
    knowledge?: KnowledgeSource[];
    rateLimit?: {
        maxRequests: number;
        windowMs: number;
    };
    budgets?: Budgets | false;
    preChatFields?: string[];
    webhooks?: WebhookConfig[];
    analytics?: boolean;
    analyticsToken?: string;
    storage?: ChatCopsStorage;
    retention?: {
        conversationsDays?: number;
    };
    allowedOrigins?: string[];
    clientIp?: ClientIpResolver;
    sessionSecrets?: string[];
    sessionTtlSec?: number;
    allowAnonymous?: boolean;
    turnstile?: TurnstileConfig;
    identity?: {
        secret: string;
        tiers?: Record<string, Budgets>;
    };
    exposeUsage?: boolean;
}

export declare function chatcopsVercelHandler(config: ChatCopsServerConfig): (req: Request) => Promise<Response>;

export type ChatFormat = 'v1' | 'legacy' | 'ai-sdk';

export type ChatHandler = ReturnType<typeof createChatHandler>;

export declare const chatRequestSchema: z.ZodObject<{
    conversationId: z.ZodString;
    locale: z.ZodOptional<z.ZodString>;
    message: z.ZodString;
    messageId: z.ZodOptional<z.ZodString>;
    pageContext: z.ZodOptional<z.ZodObject<{
        contentSnippet: z.ZodOptional<z.ZodString>;
        data: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodString>, Record<string, string>, Record<string, string>>>;
        description: z.ZodOptional<z.ZodString>;
        title: z.ZodString;
        url: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        contentSnippet?: string | undefined;
        data?: Record<string, string> | undefined;
        description?: string | undefined;
        title: string;
        url: string;
    }, {
        contentSnippet?: string | undefined;
        data?: Record<string, string> | undefined;
        description?: string | undefined;
        title: string;
        url: string;
    }>>;
    regenerate: z.ZodOptional<z.ZodUnion<[
        z.ZodBoolean,
        z.ZodObject<{
            assistantMessageId: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            assistantMessageId: string;
        }, {
            assistantMessageId: string;
        }>
    ]>>;
    userData: z.ZodOptional<z.ZodEffects<z.ZodRecord<z.ZodString, z.ZodString>, Record<string, string>, Record<string, string>>>;
}, "strip", z.ZodTypeAny, {
    conversationId: string;
    locale?: string | undefined;
    message: string;
    messageId?: string | undefined;
    pageContext?: {
        contentSnippet?: string | undefined;
        data?: Record<string, string> | undefined;
        description?: string | undefined;
        title: string;
        url: string;
    } | undefined;
    regenerate?: boolean | {
        assistantMessageId: string;
    } | undefined;
    userData?: Record<string, string> | undefined;
}, {
    conversationId: string;
    locale?: string | undefined;
    message: string;
    messageId?: string | undefined;
    pageContext?: {
        contentSnippet?: string | undefined;
        data?: Record<string, string> | undefined;
        description?: string | undefined;
        title: string;
        url: string;
    } | undefined;
    regenerate?: boolean | {
        assistantMessageId: string;
    } | undefined;
    userData?: Record<string, string> | undefined;
}>;

export type ChatStart = {
    ok: true;
    parts: AsyncGenerator<WirePart, void>;
} | {
    error: WireErrorBody['error'];
    legacy: LegacyChunk & {
        details?: unknown;
    };
    ok: false;
    status: number;
};

export type ClientIpResolver = (request: Request) => string | null | undefined;

export declare function createChatHandler(config: ChatCopsServerConfig): {
    analyticsStats: (range?: {
        from?: number;
        to?: number;
    }) => Promise<AnalyticsStats | null>;
    cleanup: () => void;
    getAnalytics: () => AnalyticsStats | null;
    handleChat: (body: unknown, clientIp?: string, options?: {
        signal?: AbortSignal;
    }) => AsyncGenerator<string>;
    logger: import("@chatcops/core").Logger;
    protocolStats: () => {
        "ai-sdk": number;
        legacy: number;
        v1: number;
    };
    purge: (now?: number) => Promise<number | null>;
    startChat: (body: unknown, clientIp?: string, options?: StartChatOptions) => Promise<ChatStart>;
    startSession: ((body: unknown, origin: string | null, clientIp?: string) => Promise<import("./security/sessions.js").SessionReply>) | undefined;
};

export declare class ServerAnalytics {
    constructor();
    track(event: string, data?: Record<string, unknown>): void;
    getStats(): AnalyticsStats;
}

export declare const SIGNATURE_HEADER = "X-ChatCops-Signature";

export declare function signWebhook(body: string, secret: string, timestampSec?: number): Promise<string>;

export interface StartChatOptions {
    signal?: AbortSignal;
    format?: ChatFormat;
    authorization?: string | null;
    origin?: string | null;
}

export interface TurnstileConfig {
    secretKey: string;
    action?: string;
    expectedHostnames?: string[];
    timeoutMs?: number;
}

export type ValidatedChatRequest = z.infer<typeof chatRequestSchema>;

export declare function verifyWebhook(options: {
    body: string;
    now?: number;
    secret: string;
    signature: string | null | undefined;
    toleranceSec?: number;
}): Promise<boolean>;

export declare class WebhookDispatcher {
    constructor(configs: WebhookConfig[], timeoutMs?: number, logger?: Logger);
    dispatch(event: string, data: unknown): Promise<void>;
}

export interface WebhookEvent<T = unknown> {
    id: string;
    type: string;
    created: number;
    data: T;
}
```

## `@chatcops/server/express`

```ts
export declare function chatcopsAnalyticsHandler(config: ChatCopsServerConfig): (req: Request, res: Response) => Promise<void>;

export declare function chatcopsMiddleware(config: ChatCopsServerConfig): (req: Request, res: Response, _next: NextFunction) => Promise<void>;
```

## `@chatcops/server/vercel`

```ts
export declare function chatcopsVercelHandler(config: ChatCopsServerConfig): (req: Request) => Promise<Response>;
```

## `@chatcops/server/cloudflare`

```ts
export declare function chatcopsCloudflareHandler(config: ChatCopsServerConfig): (request: Request, _env?: unknown, ctx?: {
    waitUntil?(promise: Promise<unknown>): void;
}) => Promise<Response>;
```
