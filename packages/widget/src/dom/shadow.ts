import widgetStyles from '../styles/widget.css?inline';

export function createShadowRoot(container?: HTMLElement): ShadowRoot {
  const host = document.createElement('div');
  host.id = 'chatcops-root';

  if (container) {
    container.appendChild(host);
  } else {
    document.body.appendChild(host);
  }

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = widgetStyles;
  shadow.appendChild(style);

  return shadow;
}

export function destroyShadowRoot(container?: HTMLElement): void {
  const searchRoot = container ?? document.body;
  const host = searchRoot.querySelector('#chatcops-root') ?? document.getElementById('chatcops-root');
  if (host) host.remove();
}
