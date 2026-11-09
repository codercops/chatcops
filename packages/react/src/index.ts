'use client';

import { useEffect, useRef } from 'react';
import type { MessageData, WidgetConfig, WidgetUpdate } from '@chatcops/widget';

export type ChatCopsProps = WidgetConfig & {
  onOpen?: () => void;
  onClose?: () => void;
  onMessage?: (message: MessageData) => void;
  onError?: (error: Error) => void;
  onLeadCaptured?: (lead?: Record<string, unknown>) => void;
  onPreChatSubmit?: (data: Record<string, string>) => void;
};

export interface ChatCopsHandle {
  open: () => void;
  close: () => void;
  toggle: () => void;
  send: (text: string, options?: { open?: boolean }) => Promise<void>;
  update: (changes: WidgetUpdate) => void;
}

type WidgetModule = typeof import('@chatcops/widget').default;

let W: WidgetModule | undefined, P: Promise<WidgetModule> | undefined;

const load = async (): Promise<WidgetModule> => {
  if (!P) P = import('@chatcops/widget').then((m) => m.default);
  W = await P;
  return W;
};

const EV = ['open', 'close', 'message', 'error', 'leadCaptured', 'preChatSubmit'] as const;
const EK = new Set(EV.map((e) => `on${e[0].toUpperCase()}${e.slice(1)}`));
const UK = new Set(['branding', 'welcomeMessage', 'disclosure', 'suggestions', 'placeholder', 'strings', 'privacyUrl', 'theme']);

const eq = (a: unknown, b: unknown): boolean =>
  Object.is(a, b) ||
  (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b));

const hasLostField = (prev: unknown, next: unknown): boolean => {
  if (!prev || typeof prev !== 'object') return false;
  if (!next || typeof next !== 'object') return true;
  for (const k of Object.keys(prev as Record<string, unknown>)) {
    const pv = (prev as Record<string, unknown>)[k];
    if (pv !== undefined) {
      const nv = (next as Record<string, unknown>)[k];
      if (nv === undefined) return true;
      if (typeof pv === 'object' && pv !== null && hasLostField(pv, nv)) return true;
    }
  }
  return false;
};

const initCfg = (props: ChatCopsProps, ref: React.RefObject<ChatCopsProps>): WidgetConfig => {
  const c = { ...props } as Record<string, unknown>;
  for (const k of EK) delete c[k];
  if (typeof props.userToken === 'function') {
    c.userToken = () => {
      const fn = ref.current?.userToken;
      return typeof fn === 'function' ? fn() : fn;
    };
  }
  if (typeof props.onConsentRequest === 'function') {
    c.onConsentRequest = () => ref.current?.onConsentRequest?.();
  }
  return c as unknown as WidgetConfig;
};

const diff = (
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): { reinit?: boolean; update?: WidgetUpdate } => {
  if ((a.theme as Record<string, unknown> | undefined)?.position !== (b.theme as Record<string, unknown> | undefined)?.position) {
    return { reinit: true };
  }
  const u: Record<string, unknown> = {};
  let has = false;
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);

  for (const k of allKeys) {
    if (EK.has(k)) continue;

    if (k === 'container') {
      if (!Object.is(a.container, b.container)) return { reinit: true };
      continue;
    }

    if (k === 'userToken') {
      if (typeof a.userToken === 'function' && typeof b.userToken === 'function') continue;
      if (!Object.is(a.userToken, b.userToken)) return { reinit: true };
      continue;
    }

    if (k === 'onConsentRequest') {
      if (typeof a.onConsentRequest === 'function' && typeof b.onConsentRequest === 'function') continue;
      if (!Object.is(a.onConsentRequest, b.onConsentRequest)) return { reinit: true };
      continue;
    }

    if (k === 'branding' || k === 'strings' || k === 'theme') {
      if (hasLostField(a[k], b[k])) return { reinit: true };
      if (!eq(a[k], b[k])) {
        has = true;
        u[k] = b[k];
      }
      continue;
    }

    if (UK.has(k)) {
      if (!eq(a[k], b[k])) {
        has = true;
        u[k] = b[k];
      }
      continue;
    }

    if (!eq(a[k], b[k])) {
      return { reinit: true };
    }
  }

  return has ? { update: u as WidgetUpdate } : {};
};

export function ChatCops(props: ChatCopsProps): null {
  const ref = useRef(props);
  ref.current = props;
  const prev = useRef(props);
  const ok = useRef(false);

  useEffect(() => {
    let act = true,
      un: Array<() => void> = [];

    load().then((w) => {
      if (!act) return;
      un = EV.map((e) =>
        w.on(
          e,
          ((...args: unknown[]) =>
            (ref.current as unknown as Record<string, ((...a: unknown[]) => void) | undefined>)[
              `on${e[0].toUpperCase()}${e.slice(1)}`
            ]?.(...args)) as never,
        ),
      );
      w.init(initCfg(ref.current, ref));
      prev.current = ref.current;
      ok.current = true;
    });

    return () => {
      act = false;
      ok.current = false;
      for (const f of un) f();
      W?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!ok.current || !W) return;
    const d = diff(
      prev.current as unknown as Record<string, unknown>,
      props as unknown as Record<string, unknown>,
    );
    if (d.reinit) {
      prev.current = props;
      W.init(initCfg(props, ref));
    } else if (d.update) {
      W.update(d.update);
      prev.current = props;
    }
  });

  return null;
}

const handle: ChatCopsHandle = {
  open: () => W?.open(),
  close: () => W?.close(),
  toggle: () => W?.toggle(),
  send: (t: string, o?: { open?: boolean }) => W?.sendMessage(t, o) ?? Promise.resolve(),
  update: (c: WidgetUpdate) => W?.update(c),
};

export function useChatCops(): ChatCopsHandle {
  return handle;
}

export default ChatCops;
export type { WidgetConfig, WidgetUpdate, MessageData };
