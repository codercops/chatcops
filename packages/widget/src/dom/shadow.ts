import widgetStyles from '../styles/widget.css?inline';

export function createShadowRoot(): ShadowRoot {
  const host = document.createElement('div');
  host.id = 'chatcops-root';
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = widgetStyles;
  shadow.appendChild(style);

  return shadow;
}

export function destroyShadowRoot(): void {
  const host = document.getElementById('chatcops-root');
  if (host) host.remove();
}
