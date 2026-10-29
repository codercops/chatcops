/**
 * Private class members the minifier renames to short names in the panel
 * and single-file builds, to keep them in their size budgets. Renaming a
 * property renames it everywhere in the bundle, so a name that is also a
 * config field, a key in a request body, a stored field or a DOM property
 * would break the build that sites load from the CDN, and only there.
 * tests/mangle.test.ts checks every name in CHECKED.
 */

/** Names from before the check. Internal on both ends, and the e2e suite runs against the minified build. */
const EARLIER = [
  'mounted', 'fab', 'panel', 'bubble', 'preChatFormEl', 'namespace', 'hydrated', 'isStreaming', 'destroyed',
  'abortController', 'retryRequests', 'eventHandlers', 'containerEl', 'autoOpenTimer', 'unreadReplies',
  'savedOverflow', 'shadow', 'unreadLabel', 'openLabel', 'closeLabel', 'badge', 'el', 'inline',
  'messagesContainer', 'isVisible', 'typingEl', 'suggestionsEl', 'area', 'textarea', 'sendBtn', 'onSend', 'timerId',
];

/**
 * Declared `private`, and only ever read or written as `this.<name>`: never
 * an object key, never on another object, never in a string.
 */
export const CHECKED = [
  'announcement', 'autoResize', 'cleanupEmptyActionContainers', 'clearError', 'createActionButton',
  'createActionsContainer', 'createField', 'createMessageElement', 'createRequest', 'disclosureEl', 'endStream',
  'ensureActionsContainer', 'errorElements', 'escapeHtml', 'fieldElements', 'findLatestRegeneratableAssistant',
  'findMessage', 'findUserMessageForAssistant', 'getErrorMessage', 'handleKeydown', 'handlePreChatSubmit',
  'handleRegenerate', 'handleRetry', 'handleSend', 'handleSubmit', 'isStale', 'isValidEmail', 'lockScroll',
  'markFailed', 'nearBottom', 'pageData', 'panelLabels', 'renderDisclosure', 'renderHeader', 'renderMessageElement',
  'renderStream', 'renderSuggestions', 'resolveContainer', 'resolveErrorType', 'restoreScroll', 'saveHistory',
  'scrollToBottom', 'sendToServer', 'sessionKey', 'setHidden', 'showChatView', 'showError',
  'showLatestRegenerateButton', 'streams', 'submitBtn', 'ttlMs', 'updateSubmitState', 'userDataSentWith', 'userFromSite',
];

export const MANGLED_PROPERTIES = new RegExp(`^(?:${[...EARLIER, ...CHECKED].join('|')})$`);
