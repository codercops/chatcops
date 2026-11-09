import { chatcopsVercelHandler } from './vercel.js';
import type { ChatCopsServerConfig } from '../config.js';

export function chatcopsNext(config: ChatCopsServerConfig) {
  const handler = chatcopsVercelHandler(config);
  return { POST: handler, OPTIONS: handler };
}
