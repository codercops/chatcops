import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AssertionCheck, TurnResult } from '../types.js';

type JavaScriptModule = { default?: (turn: TurnResult, conversation: TurnResult[]) => unknown };

const cache = new Map<string, JavaScriptModule>();

async function loadModule(path: string): Promise<JavaScriptModule> {
  const cached = cache.get(path);
  if (cached) return cached;
  const mod = (await import(pathToFileURL(path).href)) as JavaScriptModule;
  cache.set(path, mod);
  return mod;
}

/**
 * `javascript: ./checks/mentions-plan.mjs`: loads the module (relative to the
 * eval file) and calls its default export with `(turn, conversation)`. It may
 * return a boolean, or `{ pass, reason?, score? }`, and may be async. A missing
 * file, a module without a default function, or a throw inside it are failures
 * with the file name in the reason.
 */
export const javascript: AssertionCheck = async (value, turn, conversation, context) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('javascript takes a path to a module');
  const dir = context.fixture ? resolve(context.fixture, '..') : process.cwd();
  const path = resolve(dir, value);
  const name = basename(path);

  let mod: JavaScriptModule;
  try {
    mod = await loadModule(path);
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof mod.default !== 'function') {
    throw new Error(`${name}: the module has no default function`);
  }

  let result: unknown;
  try {
    result = await mod.default(turn, conversation);
  } catch (error) {
    throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof result === 'boolean') {
    return { pass: result, reason: result ? `${name} returned true` : `${name} returned false` };
  }
  if (result !== null && typeof result === 'object' && 'pass' in result && typeof (result as { pass: unknown }).pass === 'boolean') {
    const { pass, reason, score } = result as { pass: boolean; reason?: string; score?: number };
    return { pass, ...(reason !== undefined ? { reason } : {}), ...(score !== undefined ? { score } : {}) };
  }
  throw new Error(`${name}: the default export must return a boolean or { pass, reason?, score? }`);
};
