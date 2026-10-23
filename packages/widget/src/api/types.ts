export interface WidgetChatRequest {
  conversationId: string;
  message: string;
  messageId?: string;
  /** `{ assistantMessageId }` only once the server speaks protocol v1; 0.5 servers take `true`. */
  regenerate?: boolean | { assistantMessageId: string };
  pageContext?: {
    url: string;
    title: string;
    description?: string;
    contentSnippet?: string;
  };
  locale?: string;
  userData?: Record<string, string>;
}

export interface WidgetChatChunk {
  /** The server gave this conversation a new id along with its session token. */
  conversationId?: string;
  /** The id the server saves the reply under (protocol v1). */
  messageId?: string;
  content?: string;
  done?: boolean;
  error?: string;
  leadCaptured?: boolean;
  leadData?: Record<string, unknown>;
  suggestedActions?: string[];
}
