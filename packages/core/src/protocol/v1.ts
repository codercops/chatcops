import type { JSONSchema, PageContext, ToolExecutor } from '../types.js';

/**
 * Version 1 of the stream between the widget and the server.
 *
 * The widget asks for it with `"protocol": 1` in the request body. A body
 * field rather than a header, because servers before 0.6 only allow
 * `Content-Type` in their CORS preflight. A server that doesn't know the field
 * ignores it and answers in the old format, and the widget tells the two apart
 * by the first part: v1 always starts with `start`.
 *
 * Every part is one SSE line, `data: <json>`. Clients ignore part types they
 * don't know, so adding a part is not a version change; changing or removing
 * one is.
 */
export const PROTOCOL_VERSION = 1 as const;

export type WireErrorCode =
  // Before the stream starts, sent with an HTTP status
  | 'invalid_request'
  | 'session_required'
  | 'token_expired'
  | 'conversation_mismatch'
  | 'origin_not_allowed'
  | 'conversation_busy'
  | 'payload_too_large'
  | 'rate_limited'
  | 'provider_unavailable'
  // During the stream, as an `error` part
  | 'provider_error'
  | 'tool_error'
  | 'budget_exceeded'
  | 'content_filtered'
  | 'internal_error'
  | 'timeout';

export type WireFinishReason =
  | 'stop'
  | 'length'
  | 'client-tool-calls'
  | 'approval-required'
  | 'handoff'
  | 'error'
  | 'aborted';

export interface WireAgent {
  name: string;
  avatarUrl?: string;
}

export type WirePart =
  | {
      type: 'start';
      protocol: typeof PROTOCOL_VERSION;
      conversationId: string;
      /** The id the server saves the reply under. */
      messageId: string;
      resumed?: boolean;
      /** Optional server features the widget can turn on. */
      capabilities?: { session?: boolean };
    }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'source'; sourceId: string; url: string; title?: string; snippet?: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: unknown;
      executor: ToolExecutor;
      needsApproval?: boolean;
      title?: string;
    }
  | { type: 'tool-result'; toolCallId: string; output?: unknown; error?: string }
  | { type: 'lead-captured'; lead: Record<string, unknown> }
  | {
      type: 'handoff';
      status: 'requested' | 'queued' | 'connected' | 'ended';
      agent?: WireAgent;
      pollAfterMs?: number;
    }
  | { type: 'agent-message'; messageId: string; text: string; agent: WireAgent; timestamp: number }
  | { type: 'suggestions'; items: string[] }
  | {
      type: 'error';
      code: WireErrorCode;
      message?: string;
      retryable: boolean;
      retryAfterMs?: number;
      scope?: 'conversation' | 'session' | 'ip' | 'global';
    }
  | {
      type: 'finish';
      reason: WireFinishReason;
      /** Only sent when the server is configured to expose usage. */
      usage?: { inputTokens: number; outputTokens: number };
      pendingToolCalls?: string[];
      resumeToken?: string;
    };

export type WirePartType = WirePart['type'];

/** A tool the page offers, run in the browser (page tools). */
export interface ClientToolManifest {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  needsApproval?: boolean;
  title?: string;
}

export interface ChatRequestV1 {
  protocol: typeof PROTOCOL_VERSION;
  conversationId: string;
  /** Absent when the request only sends tool results or approvals. */
  message?: string;
  messageId?: string;
  /** `true` is the 0.5 form and regenerates the latest reply. */
  regenerate?: boolean | { assistantMessageId: string };
  toolResults?: Array<{ toolCallId: string; output?: unknown; error?: string }>;
  toolApprovals?: Array<{ toolCallId: string; approved: boolean; reason?: string }>;
  resumeToken?: string;
  clientTools?: ClientToolManifest[];
  pageContext?: PageContext;
  locale?: string;
  userData?: Record<string, string>;
}

/** The JSON body of an error answered before the stream starts. */
export interface WireErrorBody {
  error: {
    code: WireErrorCode;
    message?: string;
    retryAfterMs?: number;
  };
}
