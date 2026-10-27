import { describe, it, expect, beforeEach } from 'vitest';
import { accentTextColors, applyTheme, contrastRatio } from '../src/theme.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs from the repo root or from the package, depending on how it's started.
const cssPath = ['src/styles/launcher.css', 'packages/widget/src/styles/launcher.css']
  .map((p) => resolve(process.cwd(), p))
  .find((p) => existsSync(p))!;
const css = readFileSync(cssPath, 'utf8');

describe('applyTheme', () => {
  let host: HTMLElement;
  let root: ShadowRoot;

  const get = (name: string) => host.style.getPropertyValue(name);

  beforeEach(() => {
    host = document.createElement('div');
    root = host.attachShadow({ mode: 'open' });
  });

  describe('borderRadius', () => {
    it('adds px to a number', () => {
      applyTheme(root, { borderRadius: 12 });
      expect(get('--cc-radius')).toBe('12px');
    });

    it('adds px to a numeric string', () => {
      applyTheme(root, { borderRadius: '12' });
      expect(get('--cc-radius')).toBe('12px');
    });

    it('adds px to zero and to decimals', () => {
      applyTheme(root, { borderRadius: 0 });
      expect(get('--cc-radius')).toBe('0px');
      applyTheme(root, { borderRadius: '2.5' });
      expect(get('--cc-radius')).toBe('2.5px');
      applyTheme(root, { borderRadius: '.5' });
      expect(get('--cc-radius')).toBe('.5px');
    });

    it('leaves values that already have a unit unchanged', () => {
      applyTheme(root, { borderRadius: '1rem' });
      expect(get('--cc-radius')).toBe('1rem');
      applyTheme(root, { borderRadius: '12px' });
      expect(get('--cc-radius')).toBe('12px');
    });

    it('does not set the variable when the value is missing, empty or not a finite number', () => {
      applyTheme(root, {});
      expect(get('--cc-radius')).toBe('');
      applyTheme(root, { borderRadius: '' });
      expect(get('--cc-radius')).toBe('');
      applyTheme(root, { borderRadius: '   ' });
      expect(get('--cc-radius')).toBe('');
      applyTheme(root, { borderRadius: Number.NaN });
      expect(get('--cc-radius')).toBe('');
    });
  });

  it('sets --cc-accent and a darker --cc-accent-hover from accent', () => {
    applyTheme(root, { accent: '#6366f1' });
    expect(get('--cc-accent')).toBe('#6366f1');
    // 10% darker: rgb(99, 102, 241) -> rgb(89, 92, 217)
    expect(get('--cc-accent-hover')).toBe('#595cd9');
  });

  it('sets --cc-bg and lighter surface and input colors from bgColor', () => {
    applyTheme(root, { bgColor: '#0a0a0a' });
    expect(get('--cc-bg')).toBe('#0a0a0a');
    // 8% and 14% of the way to white: 10 -> 30 (#1e) and 10 -> 44 (#2c)
    expect(get('--cc-bg-surface')).toBe('#1e1e1e');
    expect(get('--cc-bg-input')).toBe('#2c2c2c');
  });
});

describe('accent text contrast', () => {
  it('measures contrast like WCAG', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#6366f1')).toBeCloseTo(4.47, 2);
  });

  it('keeps white text on an accent that already passes', () => {
    expect(accentTextColors('#4f46e5')).toEqual({ onAccent: '#ffffff', background: '#4f46e5' });
  });

  it('switches to dark text on light accents and keeps their exact color', () => {
    expect(accentTextColors('#ffcc00')).toEqual({ onAccent: '#0a0a0a', background: '#ffcc00' });
    expect(accentTextColors('#E07A5F')).toEqual({ onAccent: '#0a0a0a', background: '#E07A5F' });
  });

  it('darkens a mid accent just enough when neither text color passes', () => {
    const pair = accentTextColors('#6366f1');
    expect(pair).toEqual({ onAccent: '#ffffff', background: '#6164ec' });
    expect(contrastRatio('#ffffff', pair!.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('every result reaches 4.5:1', () => {
    for (const accent of ['#6366f1', '#10b981', '#ef4444', '#f59e0b', '#06b6d4', '#8b5cf6', '#ec4899', '#777', '#fff', '#000']) {
      const pair = accentTextColors(accent)!;
      expect(contrastRatio(pair.onAccent, pair.background), accent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('returns null for colors it cannot measure', () => {
    expect(accentTextColors('rgb(99, 102, 241)')).toBeNull();
    expect(accentTextColors('rebeccapurple')).toBeNull();
  });

  it('the CSS defaults match what the default accent computes to', () => {
    const defaultAccent = css.match(/--cc-accent: (#[\da-f]+);/i)![1];
    const pair = accentTextColors(defaultAccent)!;
    expect(css).toContain(`--cc-on-accent: ${pair.onAccent};`);
    expect(css).toContain(`--cc-accent-contrast: ${pair.background};`);
  });

  it('applyTheme sets both tokens, and falls back to the accent for non-hex colors', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    applyTheme(root, { accent: '#ffcc00' });
    expect(host.style.getPropertyValue('--cc-on-accent')).toBe('#0a0a0a');
    expect(host.style.getPropertyValue('--cc-accent-contrast')).toBe('#ffcc00');

    applyTheme(root, { accent: 'rgb(1, 2, 3)' });
    expect(host.style.getPropertyValue('--cc-accent-contrast')).toBe('rgb(1, 2, 3)');
  });
});

describe('focus ring', () => {
  const widgetCss = readFileSync(resolve(__dirname, '../src/styles/widget.css'), 'utf8');
  const prechatCss = readFileSync(resolve(__dirname, '../src/styles/prechat.css'), 'utf8');

  it('defines --cc-focus-ring on :host', () => {
    expect(css).toContain('--cc-focus-ring: 0 0 0 2px var(--cc-bg), 0 0 0 4px var(--cc-accent);');
  });

  it('applies --cc-focus-ring to the launcher button on :focus-visible', () => {
    expect(css).toContain('.cc-fab:focus-visible');
    expect(css).toMatch(/\.cc-fab:focus-visible\s*\{[^}]*box-shadow:\s*var\(--cc-focus-ring\)/);
  });

  it('stops the pulse animation on launcher focus-visible', () => {
    expect(css).toMatch(/\.cc-fab:focus-visible\s*\{[^}]*animation:\s*none;/);
  });

  it('applies --cc-focus-ring to widget controls on :focus-visible', () => {
    for (const selector of [
      '.cc-header-close:focus-visible',
      '.cc-send-btn:focus-visible',
      '.cc-message-retry:focus-visible',
      '.cc-message-regenerate:focus-visible',
      '.cc-bubble-close:focus-visible',
      '.cc-input:focus-visible',
    ]) {
      expect(widgetCss).toContain(selector);
    }
    expect(widgetCss).toMatch(/box-shadow:\s*var\(--cc-focus-ring\);/);
  });

  it('applies --cc-focus-ring to pre-chat controls on :focus-visible', () => {
    for (const selector of [
      '.cc-prechat-input:focus-visible',
      '.cc-prechat-select:focus-visible',
      '.cc-prechat-textarea:focus-visible',
      '.cc-prechat-submit:focus-visible',
    ]) {
      expect(prechatCss).toContain(selector);
    }
    expect(prechatCss).toMatch(/box-shadow:\s*var\(--cc-focus-ring\);/);
  });

  it('allows customizing --cc-focus-ring on the host element', () => {
    const host = document.createElement('div');
    host.style.setProperty('--cc-focus-ring', '0 0 0 3px red');
    expect(host.style.getPropertyValue('--cc-focus-ring')).toBe('0 0 0 3px red');
  });
});

