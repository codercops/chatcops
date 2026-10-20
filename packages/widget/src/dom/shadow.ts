import widgetStyles from '../styles/widget.css?inline';

const HOST_ID = 'chatcops-root';

/**
 * Creates the widget's host element and shadow root. The first widget on the
 * page keeps the id `chatcops-root` (sites style it); later ones get
 * `chatcops-root-2`, `chatcops-root-3` and so on. Every host has the class
 * `chatcops-root`.
 */
export function createShadowRoot(container?: HTMLElement): ShadowRoot {
  const host = document.createElement('div');
  host.id = nextHostId();
  host.className = HOST_ID;

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

/** Removes the host this widget created, and no other widget's. */
export function destroyShadowRoot(shadow?: ShadowRoot): void {
  shadow?.host.remove();
}

function nextHostId(): string {
  if (!document.getElementById(HOST_ID)) return HOST_ID;
  let n = 2;
  while (document.getElementById(`${HOST_ID}-${n}`)) n += 1;
  return `${HOST_ID}-${n}`;
}
