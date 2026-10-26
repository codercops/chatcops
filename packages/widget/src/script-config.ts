import type { WidgetConfig } from './widget.js';

export function parseAutoOpen(value?: string): boolean | number | undefined {
  if (value === undefined) return undefined;
  if (value === '' || value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return undefined;
}

/** The widget config from a script tag's `data-*` attributes, or `undefined` without `data-api-url`. */
export function configFromScript(script: HTMLScriptElement): WidgetConfig | undefined {
  const apiUrl = script.dataset.apiUrl;
  if (!apiUrl) return undefined;

  const mode = script.dataset.mode as 'popup' | 'inline' | undefined;
  const container = script.dataset.container;

  return {
    apiUrl,
    turnstileSiteKey: script.dataset.turnstileSiteKey,
    userToken: script.dataset.userToken,
    mode: mode || undefined,
    container: container || undefined,
    theme: {
      accent: script.dataset.accent,
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
          delay: script.dataset.welcomeBubbleDelay ? parseInt(script.dataset.welcomeBubbleDelay, 10) : undefined,
        }
      : undefined,
    autoOpen: parseAutoOpen(script.dataset.autoOpen),
    placeholder: script.dataset.placeholder,
    locale: script.dataset.locale,
  };
}
