# @chatcops/widget

Embeddable AI chatbot widget. Zero dependencies, Shadow DOM isolated, ~50KB gzipped.

## Install

### Script Tag (easiest)

```html
<script
  src="https://cdn.jsdelivr.net/npm/@chatcops/widget/dist/chatcops.min.js"
  data-api-url="https://your-api.com/chat"
  data-accent="#6366f1">
</script>
```

The widget auto-initializes from `data-*` attributes on `DOMContentLoaded`.

### npm

```bash
npm install @chatcops/widget
```

```typescript
import ChatCops from '@chatcops/widget';

ChatCops.init({
  apiUrl: 'https://your-api.com/chat',
  theme: { accent: '#6366f1' },
});
```

## Modes

### Popup (default)

Floating action button (FAB) in the corner. Clicking it opens a chat panel.

```typescript
ChatCops.init({
  apiUrl: '/chat',
  mode: 'popup',                    // default
  theme: { position: 'bottom-right' }, // or 'bottom-left'
});
```

### Inline

Renders directly inside a container element. No FAB, no welcome bubble.

```typescript
ChatCops.init({
  apiUrl: '/chat',
  mode: 'inline',
  container: '#chat-container',  // CSS selector or HTMLElement
});
```

## Configuration

```typescript
ChatCops.init({
  // Required
  apiUrl: 'https://your-api.com/chat',

  // Display mode
  mode: 'popup',                        // 'popup' | 'inline'
  container: '#chat',                   // required for inline mode

  // Theme
  theme: {
    accent: '#6366f1',                  // primary color
    textColor: '#ffffff',
    bgColor: '#0a0a0a',
    fontFamily: 'system-ui, sans-serif',
    borderRadius: '12px',
    position: 'bottom-right',           // 'bottom-right' | 'bottom-left'
  },

  // Branding
  branding: {
    name: 'Support Bot',
    avatar: 'https://example.com/avatar.png',
    subtitle: 'Online',
  },

  // Messages
  welcomeMessage: 'Hi! How can I help?',
  welcomeBubble: {
    text: 'Need help? Chat with us!',
    delay: 3000,                        // ms before showing
    showOnce: true,                     // per session
  },
  placeholder: 'Type a message...',

  // Behavior
  persistHistory: true,                 // localStorage, default: true
  maxMessages: 50,                      // max persisted messages
  pageContext: true,                     // send page URL/title to API
  autoOpen: 5000,                       // auto-open after ms (popup only)
  locale: 'en',

  // Callbacks
  onOpen: () => {},
  onClose: () => {},
  onMessage: (msg) => {},
  onError: (err) => {},
});
```

## API

```typescript
ChatCops.init(config)         // Initialize the widget
ChatCops.open()               // Open the chat panel (popup mode)
ChatCops.close()              // Close the chat panel
ChatCops.destroy()            // Remove widget and clean up
ChatCops.on(event, handler)   // Subscribe to events
ChatCops.off(event, handler)  // Unsubscribe
```

Events: `open`, `close`, `message`, `error`.

## Script Tag Attributes

All configuration can be set via `data-*` attributes:

```html
<script
  src="https://cdn.jsdelivr.net/npm/@chatcops/widget/dist/chatcops.min.js"
  data-api-url="/chat"
  data-mode="popup"
  data-accent="#6366f1"
  data-text-color="#ffffff"
  data-bg-color="#0a0a0a"
  data-font-family="system-ui"
  data-border-radius="12px"
  data-position="bottom-right"
  data-brand-name="Support Bot"
  data-brand-avatar="https://example.com/avatar.png"
  data-brand-subtitle="Online"
  data-welcome-message="Hi! How can I help?"
  data-welcome-bubble="Need help?"
  data-welcome-bubble-delay="3000"
  data-placeholder="Type here..."
  data-locale="en"
  data-auto-open="true">
</script>
```

## Features

- **Shadow DOM** - Fully isolated CSS/DOM, no conflicts with host site
- **SSE Streaming** - Real-time streaming responses via Server-Sent Events
- **Markdown** - Renders bold, italic, code blocks, links, and lists
- **Conversation Persistence** - localStorage for history, sessionStorage for session ID
- **Theming** - CSS custom properties, auto-derived surface colors from `bgColor`
- **Mobile Responsive** - Full-screen panel on screens below 768px
- **i18n** - Built-in locale strings with custom override support
- **Accessible** - ARIA labels, semantic HTML, keyboard navigation

## License

MIT
