import { describe, expectTypeOf, it } from 'vitest';
import ChatCops, { type WidgetLocaleStrings, type WidgetUpdate } from '../src/index.js';
import type { ChatCopsLoader } from '../src/loader/loader.js';

describe('the widget API types', () => {
  it('has the same methods in the npm build and the script tag loader', () => {
    expectTypeOf(ChatCops.sendMessage).toEqualTypeOf<(text: string, options?: { open?: boolean }) => Promise<void>>();
    expectTypeOf<ChatCopsLoader['sendMessage']>().toEqualTypeOf<(text: string, options?: { open?: boolean }) => Promise<void>>();
    expectTypeOf(ChatCops.toggle).toEqualTypeOf<() => void>();
    expectTypeOf(ChatCops.newConversation).toEqualTypeOf<() => void>();
    expectTypeOf(ChatCops.clear).toEqualTypeOf<() => void>();
    expectTypeOf<ChatCopsLoader['toggle']>().toEqualTypeOf<() => void>();
    expectTypeOf(ChatCops.version).toBeString();
    expectTypeOf<ChatCopsLoader['version']>().toBeString();
  });

  it('types setUser and setContext the same in both builds', () => {
    type User = { name?: string; email?: string; token?: string } | null;
    expectTypeOf(ChatCops.setUser).parameters.toEqualTypeOf<[User]>();
    expectTypeOf<ChatCopsLoader['setUser']>().parameters.toEqualTypeOf<[User]>();
    expectTypeOf(ChatCops.setContext).parameters.toEqualTypeOf<[Record<string, string> | null]>();
    expectTypeOf<ChatCopsLoader['setContext']>().parameters.toEqualTypeOf<[Record<string, string> | null]>();
    // @ts-expect-error: context values are strings
    ChatCops.setContext({ seats: 12 });
  });

  it('types update() the same in both builds, without position', () => {
    expectTypeOf(ChatCops.update).parameters.toEqualTypeOf<[WidgetUpdate]>();
    expectTypeOf<ChatCopsLoader['update']>().parameters.toEqualTypeOf<[WidgetUpdate]>();
    ChatCops.update({ theme: { mode: 'dark', accent: '#000' }, branding: { name: 'Sales' }, strings: { sendButton: 'Go' } });
    // @ts-expect-error: moving the chat needs init()
    ChatCops.update({ theme: { position: 'bottom-left' } });
    // @ts-expect-error: the server can't change on a running chat
    ChatCops.update({ apiUrl: '/other' });
  });

  it('takes partial strings and an optional direction in registerLocale', () => {
    expectTypeOf(ChatCops.registerLocale).parameters.toEqualTypeOf<[string, Partial<WidgetLocaleStrings>, ({ dir?: 'ltr' | 'rtl' } | undefined)?]>();
    ChatCops.registerLocale('nl', { sendButton: 'Verzenden' });
    ChatCops.registerLocale('fa', { sendButton: 'ارسال' }, { dir: 'rtl' });
    // @ts-expect-error: not a direction
    ChatCops.registerLocale('xx', {}, { dir: 'up' });
    // @ts-expect-error: not a string of the widget
    ChatCops.registerLocale('xx', { sendButtonn: 'typo' });
  });
});
