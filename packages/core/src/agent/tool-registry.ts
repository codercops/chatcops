import type { Logger } from '../logger.js';
import { runToolWithTimeout, serializeToolResult } from '../providers/tool-execution.js';
import { toolToDefinition, type ChatTool } from '../tools/base.js';
import type {
  MessagePart,
  ProviderToolCall,
  ProviderToolExecutor,
  ToolDefinition,
  ToolResult,
} from '../types.js';

export interface ToolRunContext {
  conversationId: string;
  signal: AbortSignal;
  timeoutMs?: number;
  logger?: Logger;
}

/** The tools a turn can call, and how to run them. */
export interface ToolRegistry {
  /** What the model is told about. */
  definitions: ToolDefinition[];
  /** Runs a call. Never throws: failures come back as `{ success: false }`. */
  run(call: ProviderToolCall, context: ToolRunContext): Promise<ToolResult>;
  /** Parts to add after a call, like a captured lead. */
  emits(call: ProviderToolCall, result: ToolResult): MessagePart[];
}

/**
 * Lead capture before tools could emit parts: a successful `capture_lead`
 * call adds a `lead-captured` part with the result's data. Kept for custom
 * lead tools written for 0.4.
 */
function legacyLeadPart(name: string, result: ToolResult): MessagePart[] {
  if (name !== 'capture_lead' || !result.success || !result.data) return [];
  return [{ type: 'lead-captured', lead: result.data as Record<string, unknown> }];
}

/** A registry over `ChatTool` objects, as the server configures them. */
export function toolRegistry(tools: ChatTool[] = []): ToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    definitions: tools.map(toolToDefinition),
    run(call, { conversationId, signal, timeoutMs, logger }) {
      const tool = byName.get(call.name);
      if (!tool) return Promise.resolve({ success: false, message: `Unknown tool: ${call.name}` });
      return runToolWithTimeout(
        (toolSignal) => tool.execute(call.input, { conversationId, signal: toolSignal, ...(logger ? { logger } : {}) }),
        { timeoutMs, signal, name: call.name, ...(logger ? { logger } : {}) }
      );
    },
    emits(call, result) {
      const tool = byName.get(call.name);
      return tool?.emits ? tool.emits(result) : legacyLeadPart(call.name, result);
    },
  };
}

/**
 * A registry over tool definitions and one executor function, the 0.4
 * `toolExecutor` shape. The executor gets the call and nothing else.
 */
export function executorRegistry(definitions: ToolDefinition[] = [], executor?: ProviderToolExecutor): ToolRegistry {
  return {
    definitions,
    run(call, { signal, timeoutMs, logger }) {
      if (!executor) {
        return Promise.resolve({ success: false, message: `No tool executor is configured for "${call.name}".` });
      }
      return runToolWithTimeout(() => executor(call), { timeoutMs, signal, name: call.name, ...(logger ? { logger } : {}) });
    },
    emits: (call, result) => legacyLeadPart(call.name, result),
  };
}

/** Tool output is stored with the conversation, so it's kept to JSON and a size. */
export const MAX_TOOL_OUTPUT_CHARS = 64_000;

/** The stored output of a call: what the model saw, as plain JSON. */
export function toolOutput(result: ToolResult): unknown {
  const output = serializeToolResult(result);
  let json: string;
  try {
    json = JSON.stringify(output);
  } catch {
    return { success: false, message: "The tool returned something that isn't JSON." };
  }
  if (json.length <= MAX_TOOL_OUTPUT_CHARS) return JSON.parse(json);
  return {
    success: result.success,
    data: `${JSON.stringify(output.data).slice(0, MAX_TOOL_OUTPUT_CHARS)}... (cut off: the tool returned more than ${MAX_TOOL_OUTPUT_CHARS} characters)`,
    ...(result.message ? { message: result.message } : {}),
  };
}
