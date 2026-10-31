export type ThemeMode = 'light' | 'dark' | 'auto';

const TOKEN_NAMES = [
  'accent',
  'accent-hover',
  'on-accent',
  'accent-contrast',
  'text',
  'bg',
  'bg-surface',
  'surface-raised',
  'bg-input',
  'border',
  'text-secondary',
  'danger',
  'code-bg',
  'pre-bg',
  'shadow',
  'font',
  'radius',
  'fab-size',
  'panel-width',
  'panel-height',
  'focus-ring',
] as const;

export type WidgetTokenName = (typeof TOKEN_NAMES)[number];
export type WidgetTokens = Partial<Record<WidgetTokenName, string>>;

export interface ThemeConfig {
  /**
   * `auto` (the default) follows the visitor's system setting and switches
   * when it changes. `dark` is the look the widget had before light mode.
   */
  mode?: ThemeMode;
  accent?: string;
  /** The accent in dark mode. Defaults to `accent`. */
  accentDark?: string;
  textColor?: string;
  bgColor?: string;
  fontFamily?: string;
  borderRadius?: string | number;
  tokens?: WidgetTokens;
  position?: 'bottom-right' | 'bottom-left';
}

const MODES: readonly string[] = ['light', 'dark', 'auto'];

export function applyTheme(root: ShadowRoot, theme: ThemeConfig): void {
  const host = root.host as HTMLElement;
  const mode = themeMode(theme);
  if (mode) host.dataset.ccMode = mode;
  else delete host.dataset.ccMode;
  if (theme.accent) setAccent(host, '', theme.accent);
  if (theme.accentDark) setAccent(host, '-dark', theme.accentDark);
  if (theme.textColor) {
    host.style.setProperty('--cc-text', theme.textColor);
  }
  if (theme.bgColor) {
    host.style.setProperty('--cc-bg', theme.bgColor);
    host.style.setProperty('--cc-bg-surface', lighten(theme.bgColor, 8));
    host.style.setProperty('--cc-surface-raised', lighten(theme.bgColor, 12));
    host.style.setProperty('--cc-bg-input', lighten(theme.bgColor, 14));
  }
  if (theme.fontFamily) {
    host.style.setProperty('--cc-font', theme.fontFamily);
  }
  if (theme.borderRadius !== undefined) {
    const radius = toCssLength(theme.borderRadius);
    if (radius) host.style.setProperty('--cc-radius', radius);
  }
  if (theme.tokens) {
    for (const [name, value] of Object.entries(theme.tokens)) {
      if (TOKEN_NAMES.includes(name as WidgetTokenName) && typeof value === 'string' && value.trim()) {
        host.style.setProperty(`--cc-${name}`, value);
      }
    }
  }
}

/**
 * The mode to show. A config from before light mode that sets `bgColor` or
 * `textColor` but no `mode` was made for the dark look, unless its colors are
 * light, so it keeps the mode its colors fit instead of getting light text
 * on light panels.
 */
export function themeMode(theme: ThemeConfig): ThemeMode | undefined {
  if (theme.mode && MODES.includes(theme.mode)) return theme.mode;
  if (theme.bgColor) return isHex(theme.bgColor) && relativeLuminance(theme.bgColor) > 0.4 ? 'light' : 'dark';
  if (theme.textColor) return isHex(theme.textColor) && relativeLuminance(theme.textColor) < 0.4 ? 'light' : 'dark';
  return undefined;
}

/**
 * Sets the accent and its derived shades for both modes (`suffix` ''), or
 * for dark mode only (`suffix` '-dark'). launcher.css reads these names.
 */
function setAccent(host: HTMLElement, suffix: '' | '-dark', accent: string): void {
  host.style.setProperty(`--cc-theme-accent${suffix}`, accent);
  host.style.setProperty(`--cc-theme-accent${suffix}-hover`, darken(accent, 10));
  const pair = accentTextColors(accent);
  if (pair) {
    host.style.setProperty(`--cc-theme-on-accent${suffix}`, pair.onAccent);
    host.style.setProperty(`--cc-theme-accent${suffix}-contrast`, pair.background);
  } else {
    // Non-hex colors can't be measured here; keep text on the accent as before.
    host.style.setProperty(`--cc-theme-accent${suffix}-contrast`, accent);
  }
}

/**
 * A bare number (`12` or `'12'`) is pixels. A value that already has a unit
 * (`'1rem'`, `'12px'`) is returned as is. Empty and non-finite values give ''.
 */
function toCssLength(value: string | number): string {
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  const text = String(value).trim();
  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) ? `${text}px` : text;
}

const WHITE = '#ffffff';
const NEAR_BLACK = '#0a0a0a';
/** WCAG 2.2 AA minimum for normal size text. */
const MIN_TEXT_CONTRAST = 4.5;

function isHex(color: string): boolean {
  return /^#?[\da-f]{3}(?:[\da-f]{3})?$/i.test(color.trim());
}

function relativeLuminance(hex: string): number {
  const channels = parseHex(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Picks the text color for an accent background, and the accent shade to put
 * text on, so text always reaches 4.5:1:
 * - white text when it passes on the accent as is
 * - near-black text when that passes (light accents keep their exact color)
 * - otherwise white text on the accent darkened just enough
 * Icons can keep using the plain accent with `onAccent`; they need only 3:1.
 * Returns null for colors that aren't hex, which keep the default tokens.
 */
export function accentTextColors(accent: string): { onAccent: string; background: string } | null {
  if (!isHex(accent)) return null;
  const color = accent.trim().startsWith('#') ? accent.trim() : `#${accent.trim()}`;

  if (contrastRatio(WHITE, color) >= MIN_TEXT_CONTRAST) return { onAccent: WHITE, background: color };
  if (contrastRatio(NEAR_BLACK, color) >= MIN_TEXT_CONTRAST) return { onAccent: NEAR_BLACK, background: color };

  for (let percent = 2; percent <= 60; percent += 2) {
    const darker = darken(color, percent);
    if (contrastRatio(WHITE, darker) >= MIN_TEXT_CONTRAST) return { onAccent: WHITE, background: darker };
  }
  return { onAccent: WHITE, background: NEAR_BLACK };
}

function parseHex(hex: string): [number, number, number] {
  if (!/^#?[\da-f]{3}(?:[\da-f]{3})?$/i.test(hex)) return [0, 0, 0];
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

function darken(hex: string, percent: number): string {
  const [r, g, b] = parseHex(hex);
  const f = 1 - percent / 100;
  return toHex(Math.round(r * f), Math.round(g * f), Math.round(b * f));
}

function lighten(hex: string, percent: number): string {
  const [r, g, b] = parseHex(hex);
  const f = percent / 100;
  return toHex(Math.round(r + (255 - r) * f), Math.round(g + (255 - g) * f), Math.round(b + (255 - b) * f));
}
