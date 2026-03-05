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
}

export interface WidgetChatChunk {
  content?: string;
  done?: boolean;
  error?: string;
  leadCaptured?: boolean;
  suggestedActions?: string[];
}
