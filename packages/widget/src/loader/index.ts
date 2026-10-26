/**
 * The script tag build (`chatcops.min.js`): the launcher, and the code that
 * loads the chat panel (`chatcops.panel.js`, next to this file) on demand.
 */
import { configFromScript } from '../script-config.js';
import { createLoader, type PanelModule } from './loader.js';

declare const __CHATCOPS_VERSION__: string;

const script = document.currentScript as HTMLScriptElement | null;
const panelUrl = new URL(`chatcops.panel.js?v=${__CHATCOPS_VERSION__}`, script?.src ?? location.href).href;

const ChatCops = createLoader(() => import(/* @vite-ignore */ panelUrl) as Promise<PanelModule>);
(window as unknown as { ChatCops: typeof ChatCops }).ChatCops = ChatCops;

const config = script && configFromScript(script);
if (config) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ChatCops.init(config), { once: true });
  } else {
    ChatCops.init(config);
  }
}
