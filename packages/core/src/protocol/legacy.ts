import type { WirePart } from './v1.js';

/**
 * One chunk of the stream servers before 0.6 send, and widgets before 0.6
 * read: `data: {"content":"Hi"}`, `data: {"done":true}` and so on.
 */
export interface LegacyChunk {
  content?: string;
  done?: boolean;
  error?: string;
  /** Seconds. */
  retryAfter?: number;
  leadCaptured?: boolean;
  leadData?: Record<string, unknown>;
  suggestedActions?: string[];
}

/** The chunk an old widget expects for this part, or null for parts it has no use for. */
export function toLegacyChunk(part: WirePart): LegacyChunk | null {
  switch (part.type) {
    case 'text-delta':
      return { content: part.delta };
    case 'lead-captured':
      return { leadCaptured: true, leadData: part.lead };
    case 'suggestions':
      return { suggestedActions: part.items };
    case 'error':
      return legacyError(part);
    case 'finish':
      // After an error the error chunk already went out, and after an abort
      // nobody is listening.
      return part.reason === 'error' || part.reason === 'aborted' ? null : { done: true };
    default:
      // Parts old widgets have no use for, and parts added after this was written.
      return null;
  }
}

function legacyError(part: Extract<WirePart, { type: 'error' }>): LegacyChunk {
  switch (part.code) {
    case 'rate_limited': {
      const { retryAfterMs } = part;
      if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
        return { error: 'rate_limit' };
      }
      return { error: 'rate_limit', retryAfter: Math.ceil(retryAfterMs / 1000) };
    }
    case 'timeout':
      return { error: 'timeout' };
    case 'internal_error':
      return { error: 'internal_error' };
    case 'invalid_request':
      // What 0.5 servers send for a request they can't read.
      return { error: 'Invalid request' };
    default:
      return { error: 'provider_error' };
  }
}
