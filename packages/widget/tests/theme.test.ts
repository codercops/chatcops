import { describe, it, expect, beforeEach } from 'vitest';
import { applyTheme } from '../src/theme.js';

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
