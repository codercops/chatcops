import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Widget } from '../src/widget.js';

type Internals = { conversationId: string; shadow: ShadowRoot };
const internals = (w: Widget) => w as unknown as Internals;

describe('several widgets on one page', () => {
  const widgets: Widget[] = [];
  const make = (config: ConstructorParameters<typeof Widget>[0]) => {
    const widget = new Widget(config);
    widgets.push(widget);
    widget.init();
    return widget;
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="inline-box"></div>';
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    while (widgets.length) widgets.pop()!.destroy();
    vi.restoreAllMocks();
  });

  it('a single widget keeps the default host id and session key', () => {
    const widget = make({ apiUrl: '/chat' });
    expect(internals(widget).shadow.host.id).toBe('chatcops-root');
    expect(internals(widget).shadow.host.classList.contains('chatcops-root')).toBe(true);
    expect(sessionStorage.getItem('chatcops_session_id')).toBe(internals(widget).conversationId);
  });

  it('gives a popup and an inline widget separate conversations', () => {
    const popup = make({ apiUrl: '/chat' });
    const inline = make({ apiUrl: '/chat', mode: 'inline', container: '#inline-box' });

    expect(internals(popup).conversationId).not.toBe(internals(inline).conversationId);
    expect(sessionStorage.getItem('chatcops_session_id')).toBe(internals(popup).conversationId);
    expect(sessionStorage.getItem('chatcops_session_id_inline')).toBe(internals(inline).conversationId);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"inline"'));
  });

  it('gives each host its own id and destroys only its own host', () => {
    const popup = make({ apiUrl: '/chat' });
    const inline = make({ apiUrl: '/chat', mode: 'inline', container: '#inline-box' });
    const popupHost = internals(popup).shadow.host;
    const inlineHost = internals(inline).shadow.host;
    expect(inlineHost.id).toBe('chatcops-root-2');

    inline.destroy();
    widgets.splice(widgets.indexOf(inline), 1);

    expect(inlineHost.isConnected).toBe(false);
    expect(popupHost.isConnected).toBe(true);
    expect(document.getElementById('chatcops-root')).toBe(popupHost);
  });

  it('uses the siteId for storage keys when one is set', () => {
    const a = make({ apiUrl: '/chat', siteId: 'docs' });
    const b = make({ apiUrl: '/chat', siteId: 'shop', mode: 'inline', container: '#inline-box' });
    expect(sessionStorage.getItem('chatcops_session_id_docs')).toBe(internals(a).conversationId);
    expect(sessionStorage.getItem('chatcops_session_id_shop')).toBe(internals(b).conversationId);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('hands the default storage back after destroy, and after the host leaves the page', () => {
    const first = make({ apiUrl: '/chat' });
    const firstId = internals(first).conversationId;
    first.destroy();
    widgets.splice(widgets.indexOf(first), 1);

    const second = make({ apiUrl: '/chat' });
    expect(internals(second).conversationId).toBe(firstId);

    // A single-page app removes the widget's host without calling destroy().
    internals(second).shadow.host.remove();
    const third = make({ apiUrl: '/chat' });
    expect(internals(third).conversationId).toBe(firstId);
    expect(console.warn).not.toHaveBeenCalled();
  });
});
