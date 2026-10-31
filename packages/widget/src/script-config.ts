import type { WidgetConfig } from './widget.js';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function parseAutoOpen(value?: string): boolean | number | undefined {
  if (value === undefined) return undefined;
  if (value === '' || value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) {
    const delay = Number(value);
    if (Number.isSafeInteger(delay) && delay <= MAX_TIMER_DELAY_MS) return delay;
  }
  return undefined;
}

function parseOptionalBoolean(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === '' || value === 'true') return true;
  if (value === 'false') return false;
  console.warn(
    `[chatcops] data-wait-for-consent="${value}" isn't true or false, so the chat waits for consent. Use "true" or "false".`,
  );
  return true;
}

/** The widget config from a script tag's `data-*` attributes, or `undefined` without `data-api-url`. */
export function configFromScript(script: HTMLScriptElement): WidgetConfig | undefined {
  const apiUrl = script.dataset.apiUrl;
  if (!apiUrl) return undefined;

  const mode = script.dataset.mode as 'popup' | 'inline' | undefined;
  const container = script.dataset.container;

  return {
    apiUrl,
    nonce: script.nonce || undefined,
    turnstileSiteKey: script.dataset.turnstileSiteKey,
    userToken: script.dataset.userToken,
    mode: mode || undefined,
    container: container || undefined,
    theme: {
      mode: (script.dataset.themeMode as 'light' | 'dark' | 'auto') || undefined,
      accent: script.dataset.accent,
      accentDark: script.dataset.accentDark,
      textColor: script.dataset.textColor,
      bgColor: script.dataset.bgColor,
      fontFamily: script.dataset.fontFamily,
      borderRadius: script.dataset.borderRadius,
      position: (script.dataset.position as 'bottom-right' | 'bottom-left') || undefined,
    },
    branding: {
      name: script.dataset.brandName,
      avatar: script.dataset.brandAvatar,
      subtitle: script.dataset.brandSubtitle,
    },
    welcomeMessage: script.dataset.welcomeMessage,
    welcomeBubble: script.dataset.welcomeBubble
      ? {
          text: script.dataset.welcomeBubble,
          delay: /^\d+$/.test(script.dataset.welcomeBubbleDelay ?? '') ? Number(script.dataset.welcomeBubbleDelay) : undefined,
        }
      : undefined,
    autoOpen: parseAutoOpen(script.dataset.autoOpen),
    placeholder: script.dataset.placeholder,
    disclosure:
      script.dataset.disclosure === 'false'
        ? false
        : { text: script.dataset.disclosureText, learnMoreUrl: script.dataset.disclosureUrl },
    locale: script.dataset.locale,
    dir: (['ltr', 'rtl', 'auto'] as const).find((dir) => dir === script.dataset.dir),
    persistence: (['local', 'session', 'none'] as const).find((mode) => mode === script.dataset.persistence),
    historyTtlDays: /^\d+$/.test(script.dataset.historyTtlDays ?? '') ? Number(script.dataset.historyTtlDays) : undefined,
    waitForConsent: parseOptionalBoolean(script.dataset.waitForConsent),
    privacyUrl: script.dataset.privacyUrl,
  };
}
