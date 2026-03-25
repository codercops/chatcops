export interface WidgetLocaleStrings {
  welcomeMessage: string;
  inputPlaceholder: string;
  sendButton: string;
  closeButton: string;
  errorGeneric: string;
  errorNetwork: string;
  errorRateLimit: string;
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
}

const en: WidgetLocaleStrings = {
  welcomeMessage: 'Hi! How can I help you today?',
  inputPlaceholder: 'Type a message...',
  sendButton: 'Send',
  closeButton: 'Close',
  errorGeneric: 'Something went wrong. Please try again.',
  errorNetwork: 'Connection error. Please check your network.',
  errorRateLimit: 'Too many messages. Please wait a moment.',
  typingIndicator: 'Typing...',
  poweredBy: 'Powered by ChatCops',
  newConversation: 'New conversation',
  welcomeBubbleDefault: 'Need help? Chat with us!',
  preChatTitle: 'Before we start...',
  preChatSubtitle: 'Tell us a bit about yourself',
  preChatSubmit: 'Start Chat',
  preChatRequired: 'This field is required',
  preChatInvalidEmail: 'Please enter a valid email',
  retryButton: 'Retry',
  regenerateButton: 'Regenerate',
};

const locales: Record<string, WidgetLocaleStrings> = { en };

export function getWidgetLocale(code: string, overrides?: Partial<WidgetLocaleStrings>): WidgetLocaleStrings {
  const base = locales[code] ?? en;
  return overrides ? { ...base, ...overrides } : base;
}

export function registerWidgetLocale(code: string, strings: WidgetLocaleStrings): void {
  locales[code] = strings;
}
