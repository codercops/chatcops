interface StoredConversation {
  id: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status?: 'streaming' | 'complete' | 'error';
    errorType?: 'rate_limit' | 'network' | 'provider_error' | 'timeout';
    timestamp: number;
  }>;
  updatedAt: number;
}

const KEY_PREFIX = 'chatcops_conversation';
const SESSION_KEY_PREFIX = 'chatcops_session_id';

export class ConversationStorage {
  private key: string;
  private sessionKey: string;

  /** Without a siteId the keys are the ones the widget has always used. */
  constructor(siteId?: string) {
    this.key = siteId ? `${KEY_PREFIX}_${siteId}` : KEY_PREFIX;
    this.sessionKey = siteId ? `${SESSION_KEY_PREFIX}_${siteId}` : SESSION_KEY_PREFIX;
  }

  load(): StoredConversation | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (raw === null) return null;

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.clear();
        return null;
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        typeof (parsed as Record<string, unknown>).id !== 'string' ||
        !Array.isArray((parsed as Record<string, unknown>).messages)
      ) {
        this.clear();
        return null;
      }

      const record = parsed as Record<string, unknown>;
      const rawMessages = record.messages as unknown[];
      const messages = rawMessages.filter(
        (msg): msg is StoredConversation['messages'][number] =>
          typeof msg === 'object' &&
          msg !== null &&
          !Array.isArray(msg) &&
          ((msg as Record<string, unknown>).role === 'user' ||
            (msg as Record<string, unknown>).role === 'assistant') &&
          typeof (msg as Record<string, unknown>).content === 'string',
      );

      return {
        ...record,
        id: record.id as string,
        messages,
      } as StoredConversation;
    } catch {
      return null;
    }
  }

  save(conversation: StoredConversation): void {
    try {
      const filtered = {
        ...conversation,
        messages: conversation.messages
          .filter((m) => m.status !== 'error')
          .map(({ status, ...message }) => message),
      };
      localStorage.setItem(this.key, JSON.stringify(filtered));
    } catch {
      // Storage full or unavailable
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // Ignore
    }
  }

  getSessionId(): string {
    try {
      let id = sessionStorage.getItem(this.sessionKey);
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(this.sessionKey, id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }

  isPreChatCompleted(sessionId: string): boolean {
    try {
      return sessionStorage.getItem(`chatcops-prechat-${sessionId}`) === 'true';
    } catch {
      return false;
    }
  }

  setPreChatCompleted(sessionId: string, data?: Record<string, string>): void {
    try {
      sessionStorage.setItem(`chatcops-prechat-${sessionId}`, 'true');
    } catch {
      // Storage unavailable
    }
    if (data) {
      this.setPreChatData(sessionId, data);
    }
  }

  getPreChatData(sessionId: string): Record<string, string> | null {
    try {
      const raw = sessionStorage.getItem(`chatcops-prechat-data-${sessionId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, string>;
    } catch {
      return null;
    }
  }

  setPreChatData(sessionId: string, data: Record<string, string>): void {
    try {
      sessionStorage.setItem(`chatcops-prechat-data-${sessionId}`, JSON.stringify(data));
    } catch {
      // Storage unavailable
    }
  }
}
