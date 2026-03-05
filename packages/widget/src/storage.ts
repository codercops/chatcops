interface StoredConversation {
  id: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>;
  updatedAt: number;
}

const KEY_PREFIX = 'chatcops_conversation';

export class ConversationStorage {
  private key: string;

  constructor(siteId?: string) {
    this.key = siteId ? `${KEY_PREFIX}_${siteId}` : KEY_PREFIX;
  }

  load(): StoredConversation | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      return JSON.parse(raw) as StoredConversation;
    } catch {
      return null;
    }
  }

  save(conversation: StoredConversation): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(conversation));
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
    const SESSION_KEY = 'chatcops_session_id';
    try {
      let id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  }
}
