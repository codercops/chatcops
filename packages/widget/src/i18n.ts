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
  /** `{seconds}` is how long to wait. */
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
}

const en: WidgetLocaleStrings = {
  welcomeMessage: 'How can I help you today?',
  inputPlaceholder: 'Type a message...',
  sendButton: 'Send',
  closeButton: 'Close',
  openChat: 'Open chat',
  defaultName: 'AI Assistant',
  defaultSubtitle: 'Online',
  greetingWithName: 'Hi {name}!',
  selectPlaceholder: 'Select {label}...',
  dismissBubble: 'Dismiss',
  errorGeneric: 'Something went wrong. Please try again.',
  errorNetwork: 'Connection error. Please check your network.',
  errorRateLimit: 'Too many messages. Please wait a moment.',
  errorRateLimitWait: 'Too many messages. Please try again in {seconds} seconds.',
  errorBudget: 'This chat has reached its limit.',
  errorBudgetDaily: 'The assistant has reached its limit for today. Please try again later.',
  errorUnavailable: 'The assistant is unavailable right now. Please try again later.',
  errorCutOff: 'The reply was cut off.',
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
  suggestionsLabel: 'Suggested questions',
  unreadCount: '{count} unread',
};

const locales: Record<string, WidgetLocaleStrings> = { en };

export function getWidgetLocale(code: string, overrides?: Partial<WidgetLocaleStrings>): WidgetLocaleStrings {
  const base = locales[code] ?? en;
  return overrides ? { ...base, ...overrides } : base;
}

export function registerWidgetLocale(code: string, strings: WidgetLocaleStrings): void {
  locales[code] = strings;
}
