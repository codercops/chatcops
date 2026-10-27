import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FAB } from '../../src/dom/fab.js';

const defaultOptions = {
  openLabel: 'Open chat',
  closeLabel: 'Close',
  unreadLabel: '{count} unread',
} as const;

describe('FAB', () => {
  let root: ShadowRoot;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
  });

  it('renders a button', () => {
    new FAB(root, { position: 'bottom-right', ...defaultOptions, onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab');
    expect(btn).toBeTruthy();
    expect(btn?.tagName).toBe('BUTTON');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    new FAB(root, { position: 'bottom-right', ...defaultOptions, onClick });
    const btn = root.querySelector('.cc-fab') as HTMLButtonElement;
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('adds left class for bottom-left position', () => {
    new FAB(root, { position: 'bottom-left', ...defaultOptions, onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab');
    expect(btn?.classList.contains('cc-left')).toBe(true);
  });

  it('toggles open/close state', () => {
    const fab = new FAB(root, { position: 'bottom-right', ...defaultOptions, onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab') as HTMLElement;

    fab.setOpen(true);
    expect(btn.classList.contains('cc-open')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe(defaultOptions.closeLabel);

    fab.setOpen(false);
    expect(btn.classList.contains('cc-open')).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe(defaultOptions.openLabel);
  });

  it('uses provided openLabel and closeLabel for aria-label', () => {
    const fab = new FAB(root, {
      position: 'bottom-right',
      openLabel: 'Abrir chat',
      closeLabel: 'Cerrar',
      unreadLabel: '{count} sin leer',
      onClick: vi.fn(),
    });
    const btn = root.querySelector('.cc-fab') as HTMLElement;

    expect(btn.getAttribute('aria-label')).toBe('Abrir chat');
    fab.setOpen(true);
    expect(btn.getAttribute('aria-label')).toBe('Cerrar');
    fab.setOpen(false);
    expect(btn.getAttribute('aria-label')).toBe('Abrir chat');
  });

  it('sets aria-expanded and points aria-controls at the panel', () => {
    const fab = new FAB(root, { position: 'bottom-right', ...defaultOptions, onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab') as HTMLElement;
    expect(btn.getAttribute('aria-controls')).toBe('cc-panel');
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    fab.setOpen(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');

    fab.setOpen(false);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows and hides badge', () => {
    const fab = new FAB(root, { position: 'bottom-right', ...defaultOptions, onClick: vi.fn() });
    const badge = root.querySelector('.cc-fab-badge') as HTMLElement;

    fab.showBadge();
    expect(badge.classList.contains('cc-visible')).toBe(true);

    fab.hideBadge();
    expect(badge.classList.contains('cc-visible')).toBe(false);
  });

  it('displays the unread count in the badge and includes it in aria-label', () => {
    const fab = new FAB(root, { position: 'bottom-right', ...defaultOptions, onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab') as HTMLElement;
    const badge = root.querySelector('.cc-fab-badge') as HTMLElement;

    fab.showBadge(1);
    expect(badge.textContent).toBe('1');
    expect(btn.getAttribute('aria-label')).toBe('Open chat, 1 unread');

    fab.showBadge(2);
    expect(badge.textContent).toBe('2');
    expect(btn.getAttribute('aria-label')).toBe('Open chat, 2 unread');
  });

  it('caps the badge count and aria-label at 9+ above nine', () => {
    const fab = new FAB(root, { position: 'bottom-right', ...defaultOptions, onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab') as HTMLElement;
    const badge = root.querySelector('.cc-fab-badge') as HTMLElement;

    fab.showBadge(9);
    expect(badge.textContent).toBe('9');
    expect(btn.getAttribute('aria-label')).toBe('Open chat, 9 unread');

    fab.showBadge(10);
    expect(badge.textContent).toBe('9+');
    expect(btn.getAttribute('aria-label')).toBe('Open chat, 9+ unread');

    fab.showBadge(42);
    expect(badge.textContent).toBe('9+');
    expect(btn.getAttribute('aria-label')).toBe('Open chat, 9+ unread');
  });

  it('formats aria-label using a custom unreadLabel', () => {
    const fab = new FAB(root, {
      position: 'bottom-right',
      openLabel: 'Abrir chat',
      closeLabel: 'Cerrar',
      unreadLabel: '{count} sin leer',
      onClick: vi.fn(),
    });
    const btn = root.querySelector('.cc-fab') as HTMLElement;

    fab.showBadge(3);
    expect(btn.getAttribute('aria-label')).toBe('Abrir chat, 3 sin leer');
  });

  it('resets the badge and restores the aria-label on hideBadge and when opened', () => {
    const fab = new FAB(root, { position: 'bottom-right', ...defaultOptions, onClick: vi.fn() });
    const btn = root.querySelector('.cc-fab') as HTMLElement;
    const badge = root.querySelector('.cc-fab-badge') as HTMLElement;

    fab.showBadge(2);
    expect(badge.textContent).toBe('2');
    expect(btn.getAttribute('aria-label')).toBe('Open chat, 2 unread');

    fab.hideBadge();
    expect(badge.classList.contains('cc-visible')).toBe(false);
    expect(badge.textContent).toBe('');
    expect(btn.getAttribute('aria-label')).toBe(defaultOptions.openLabel);

    fab.showBadge(4);
    expect(btn.getAttribute('aria-label')).toBe('Open chat, 4 unread');
    fab.setOpen(true);
    expect(badge.classList.contains('cc-visible')).toBe(false);
    expect(badge.textContent).toBe('');
    expect(btn.getAttribute('aria-label')).toBe(defaultOptions.closeLabel);

    fab.setOpen(false);
    expect(btn.getAttribute('aria-label')).toBe(defaultOptions.openLabel);

    fab.showBadge(2);
    fab.showBadge(0);
    expect(badge.classList.contains('cc-visible')).toBe(false);
    expect(badge.textContent).toBe('');
    expect(btn.getAttribute('aria-label')).toBe(defaultOptions.openLabel);
  });

  it('removes element on destroy', () => {
    const fab = new FAB(root, { position: 'bottom-right', ...defaultOptions, onClick: vi.fn() });
    fab.destroy();
    expect(root.querySelector('.cc-fab')).toBeNull();
  });
});
