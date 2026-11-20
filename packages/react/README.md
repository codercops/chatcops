# @chatcops/react

`<ChatCops>` and `useChatCops()` for React and Next.js. The component loads `@chatcops/widget` in an effect on the client and renders nothing itself, so it's safe in server-rendered pages and server components.

```bash
npm install @chatcops/react @chatcops/widget
```

```tsx
'use client';

import { ChatCops, useChatCops } from '@chatcops/react';

export function Chat() {
  return (
    <ChatCops
      apiUrl="/api/chat"
      branding={{ name: 'Acme' }}
      onLeadCaptured={(lead) => console.log('Lead captured:', lead)}
    />
  );
}

export function AskButton({ productName }: { productName: string }) {
  const chat = useChatCops();
  return <button onClick={() => chat.send(`Is ${productName} in stock?`)}>Ask about this product</button>;
}
```

- `<ChatCops>` takes every `WidgetConfig` option, plus `onOpen`, `onClose`, `onMessage`, `onError`, `onLeadCaptured` and `onPreChatSubmit`. Render one per page. A second one replaces the first, as a second `ChatCops.init()` does.
- Changes to `branding`, `welcomeMessage`, `suggestions`, `placeholder`, `strings`, `privacyUrl`, `disclosure` and `theme` (except `position`) go through `ChatCops.update()`. Any other change starts the widget over, which closes the panel and stops a reply in progress.
- The event props and the `userToken` and `onConsentRequest` functions are read through refs, so a new inline function on each render doesn't restart the widget.
- `useChatCops()` returns `open()`, `close()`, `toggle()`, `send(text, { open })` and `update(changes)`. Until the widget has loaded they do nothing, and `send()` resolves right away.

React 18 or later, Node 22 or later. Full guide: https://chat.codercops.com/widget/react/
