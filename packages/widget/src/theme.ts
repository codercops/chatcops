export interface ThemeConfig {
  accent?: string;
  textColor?: string;
  bgColor?: string;
  fontFamily?: string;
  borderRadius?: string;
  position?: 'bottom-right' | 'bottom-left';
}

export function applyTheme(root: ShadowRoot, theme: ThemeConfig): void {
  const host = root.host as HTMLElement;
  if (theme.accent) {
    host.style.setProperty('--cc-accent', theme.accent);
    host.style.setProperty('--cc-accent-hover', darken(theme.accent, 10));
  }
  if (theme.textColor) {
    host.style.setProperty('--cc-text', theme.textColor);
  }
  if (theme.bgColor) {
    host.style.setProperty('--cc-bg', theme.bgColor);
    host.style.setProperty('--cc-bg-surface', lighten(theme.bgColor, 8));
    host.style.setProperty('--cc-bg-input', lighten(theme.bgColor, 14));
  }
  if (theme.fontFamily) {
    host.style.setProperty('--cc-font', theme.fontFamily);
  }
  if (theme.borderRadius) {
    host.style.setProperty('--cc-radius', theme.borderRadius);
  }
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
