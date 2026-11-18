import { describe, expectTypeOf, it } from 'vitest';
import ChatCops, { type MessageData, type WidgetEventHandler } from '../src/index.js';

describe('widget event handlers', () => {
  it('get the payload of their event', () => {
    ChatCops.on('message', (message) => {
      expectTypeOf(message).toEqualTypeOf<MessageData>();
    });
    ChatCops.on('error', (error) => {
      expectTypeOf(error).toEqualTypeOf<Error>();
    });
    ChatCops.on('preChatSubmit', (data) => {
      expectTypeOf(data).toEqualTypeOf<Record<string, string>>();
    });
    ChatCops.on('leadCaptured', (lead) => {
      expectTypeOf(lead).toEqualTypeOf<Record<string, unknown> | undefined>();
    });
    ChatCops.on('open', () => {});
  });

  it('still take a loosely typed handler, as before', () => {
    const loose = (..._args: unknown[]) => {};
    ChatCops.on('message', loose);
    const typed: WidgetEventHandler<'message'> = (message) => void message.content;
    ChatCops.off('message', typed);
  });

  it("refuse a handler for another event's payload", () => {
    // @ts-expect-error a message handler doesn't get an Error
    ChatCops.on('message', (error: Error) => void error);
  });
});
