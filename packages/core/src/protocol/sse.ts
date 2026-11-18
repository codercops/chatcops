import type { WirePart } from './v1.js';

/** One event: `data: <json>` and a blank line. */
export function encodeSSE(part: WirePart | Record<string, unknown>): string {
  return `data: ${JSON.stringify(part)}\n\n`;
}

/** A comment line that keeps the connection busy while nothing else is sent. */
export const SSE_PING = ': ping\n\n';

/** Ends the stream. */
export const SSE_DONE = 'data: [DONE]\n\n';

/** Standard HTTP headers for an SSE response. */
export const SSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'X-Accel-Buffering': 'no',
});
