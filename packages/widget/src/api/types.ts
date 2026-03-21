export interface WidgetChatRequest {
  conversationId: string;
  message: string;
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
  content?: string;
  done?: boolean;
  error?: string;
  leadCaptured?: boolean;
  suggestedActions?: string[];
}
