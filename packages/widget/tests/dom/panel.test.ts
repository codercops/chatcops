import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Panel } from '../../src/dom/panel.js';

describe('Panel', () => {
  let root: ShadowRoot;

  beforeEach(() => {
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
  });

  function createPanel(overrides = {}) {
    return new Panel(root, {
      position: 'bottom-right',
      branding: { name: 'Test Bot', subtitle: 'Online' },
      placeholder: 'Type here...',
      footerText: 'Powered by ChatCops',
      onSend: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    });
  }

  it('renders panel structure', () => {
    createPanel();
    expect(root.querySelector('.cc-panel')).toBeTruthy();
    expect(root.querySelector('.cc-header')).toBeTruthy();
    expect(root.querySelector('.cc-messages')).toBeTruthy();
    expect(root.querySelector('.cc-input-area')).toBeTruthy();
    expect(root.querySelector('.cc-footer')).toBeTruthy();
  });

  it('displays branding name and subtitle', () => {
    createPanel();
    expect(root.querySelector('.cc-header-name')?.textContent).toBe('Test Bot');
    expect(root.querySelector('.cc-header-subtitle')?.textContent).toBe('Online');
  });

  it('starts hidden', () => {
    const panel = createPanel();
    expect(panel.isVisible).toBe(false);
  });

  it('shows and hides', () => {
    const panel = createPanel();
    panel.show();
    expect(panel.isVisible).toBe(true);

    panel.hide();
    expect(panel.isVisible).toBe(false);
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    createPanel({ onClose });
    const closeBtn = root.querySelector('.cc-header-close') as HTMLButtonElement;
    closeBtn.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders avatar placeholder when no avatar URL', () => {
    createPanel();
    expect(root.querySelector('.cc-header-avatar-placeholder')).toBeTruthy();
    expect(root.querySelector('.cc-header-avatar')).toBeNull();
  });

  it('renders avatar image when URL provided', () => {
    createPanel({ branding: { name: 'Bot', subtitle: 'Online', avatar: 'https://example.com/avatar.png' } });
    const img = root.querySelector('.cc-header-avatar') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toBe('https://example.com/avatar.png');
  });
});
