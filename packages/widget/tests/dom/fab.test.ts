import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FAB } from '../../src/dom/fab.js';

describe('FAB', () => {
  let root: ShadowRoot;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
  });

  it('renders a button', () => {
    new FAB(root, { position: 'bottom-right', onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab');
    expect(btn).toBeTruthy();
    expect(btn?.tagName).toBe('BUTTON');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    new FAB(root, { position: 'bottom-right', onClick });
    const btn = root.querySelector('.cc-fab') as HTMLButtonElement;
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('adds left class for bottom-left position', () => {
    new FAB(root, { position: 'bottom-left', onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab');
    expect(btn?.classList.contains('cc-left')).toBe(true);
  });

  it('toggles open/close state', () => {
    const fab = new FAB(root, { position: 'bottom-right', onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab') as HTMLElement;

    fab.setOpen(true);
    expect(btn.classList.contains('cc-open')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Close chat');

    fab.setOpen(false);
    expect(btn.classList.contains('cc-open')).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe('Open chat');
  });

  it('shows and hides badge', () => {
    const fab = new FAB(root, { position: 'bottom-right', onClick: vi.fn() });
    const badge = root.querySelector('.cc-fab-badge') as HTMLElement;

    fab.showBadge();
    expect(badge.classList.contains('cc-visible')).toBe(true);

    fab.hideBadge();
    expect(badge.classList.contains('cc-visible')).toBe(false);
  });

  it('removes element on destroy', () => {
    const fab = new FAB(root, { position: 'bottom-right', onClick: vi.fn() });
    fab.destroy();
    expect(root.querySelector('.cc-fab')).toBeNull();
  });
});
