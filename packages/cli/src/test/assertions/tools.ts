import { isDeepStrictEqual } from 'node:util';
import type { AssertionCheck } from '../types.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matchesPartial(expected: unknown, actual: unknown): boolean {
  if (Object.is(expected, actual)) return true;
  if (Array.isArray(expected)) return isDeepStrictEqual(expected, actual);
  if (isObject(expected)) {
    if (!isObject(actual)) return false;
    return Object.entries(expected).every(
      ([key, val]) => Object.hasOwn(actual, key) && matchesPartial(val, actual[key]),
    );
  }
  return false;
}

function parseCallsTool(value: unknown): { name: string; args?: Record<string, unknown> } {
  if (typeof value === 'string' && value.length > 0) {
    return { name: value };
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    const hasValidName = typeof value.name === 'string' && value.name.length > 0;
    const hasValidArgs = value.args === undefined || isObject(value.args);
    const allowed = ['name', 'args'];
    const onlyAllowedKeys = keys.length > 0 && keys.every((key) => allowed.includes(key));
    if (hasValidName && hasValidArgs && onlyAllowedKeys) {
      return { name: value.name as string, args: value.args as Record<string, unknown> | undefined };
    }
  }
  throw new Error('calls-tool takes a tool name, or { name, args }');
}

function parseNoToolCall(value: unknown): true | string {
  if (value === true) return true;
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error('no-tool-call takes true, or a tool name');
}

function formatCall(call: { name: string; input: unknown }): string {
  const args = call.input === undefined ? '' : JSON.stringify(call.input);
  return `${call.name}(${args})`;
}

function formatActual(calls: Array<{ name: string; input: unknown }>): string {
  if (!calls.length) return 'it called no tools';
  return `it called ${calls.map(formatCall).join(', ')}`;
}

/**
 * `calls-tool: "lookup_order"` or `calls-tool: { name: "lookup_order", args: { id: "A-1" } }`.
 * When `args` is supplied, matches partially against `input`: extra keys are allowed,
 * nested objects match recursively, and arrays match exactly.
 */
export const callsTool: AssertionCheck = (value, turn) => {
  const { name, args } = parseCallsTool(value);
  const calls = turn.toolCalls;
  const matched = calls.some(
    (call) => call.name === name && (args === undefined || matchesPartial(args, call.input)),
  );
  const actual = formatActual(calls);
  const target = args !== undefined ? `"${name}" with ${JSON.stringify(args)}` : `"${name}"`;
  return matched
    ? { pass: true, reason: `the turn called ${target}` }
    : { pass: false, reason: `the turn didn't call ${target} (${actual})` };
};

/**
 * `no-tool-call: true`: passes only when no tools were called in the turn.
 * `no-tool-call: "lookup_order"`: passes when that specific tool was not called.
 */
export const noToolCall: AssertionCheck = (value, turn) => {
  const target = parseNoToolCall(value);
  const calls = turn.toolCalls;
  const actual = formatActual(calls);
  if (target === true) {
    return calls.length === 0
      ? { pass: true, reason: 'the turn called no tools' }
      : { pass: false, reason: `the turn called ${calls.map(formatCall).join(', ')}` };
  }
  const called = calls.some((call) => call.name === target);
  return !called
    ? { pass: true, reason: `the turn didn't call "${target}"` }
    : { pass: false, reason: `the turn called "${target}" (${actual})` };
};
