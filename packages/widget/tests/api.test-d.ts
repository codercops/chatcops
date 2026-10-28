import { describe, expectTypeOf, it } from 'vitest';
import ChatCops, { type WidgetLocaleStrings } from '../src/index.js';
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
