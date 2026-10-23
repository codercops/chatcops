import type { CounterStore } from '../storage/types.js';
import type { TokenUsage } from '../types.js';

/** How much a scope may use. Unset limits don't apply. */
export interface BudgetLimit {
  /** Input plus output tokens, counted at face value (cached input included). */
  tokens?: number;
  /** Replies. */
  messages?: number;
}

/** `false` turns a scope off, including its default. */
export interface Budgets {
  /** Over a conversation's lifetime (counters kept 30 days). */
  perConversation?: BudgetLimit | false;
  /** Per visitor IP, per UTC day. Skipped for requests without a known IP. */
  perIpPerDay?: BudgetLimit | false;
  /** Everything together, per UTC day: the backstop for a bill you didn't expect. */
  globalPerDay?:
    | (BudgetLimit & {
        /** Dollars, priced with `price`. */
        usd?: number;
      })
    | false;
  /**
   * What a step cost in dollars, for `globalPerDay.usd`. Price cached input
   * at its discount here; token budgets count it in full.
   */
  price?: (usage: TokenUsage) => number;
}

/** Who a reply is for. */
export interface BudgetContext {
  conversationId: string;
  ip?: string;
}

export type BudgetScope = 'conversation' | 'ip' | 'global';

/** A budget is used up. The reply ends with `budget_exceeded`. */
export class BudgetExceededError extends Error {
  readonly code = 'budget_exceeded';

  constructor(readonly scope: BudgetScope) {
    super(`The ${scope} budget is used up.`);
    this.name = 'BudgetExceededError';
  }
}

export interface BudgetGuard {
  /**
   * Checks the budgets before a model request. Throws `BudgetExceededError`
   * when one is used up. Resolves the most tokens left in any token budget,
   * so the caller can cap the reply length.
   */
  before(context: BudgetContext, step: number): Promise<{ tokensLeft?: number }>;
  /** Charges a model request's usage. */
  after(context: BudgetContext, usage: TokenUsage): Promise<void>;
}

/**
 * What applies when a scope isn't set. Replies, not tokens, per conversation:
 * the widget keeps a conversation across visits, and a token count there
 * would grow with the size of your system prompt. Tokens per IP per day are
 * the cost backstop, since a script can start new conversations at will.
 * There's no global default, because no number fits every site.
 */
export const DEFAULT_BUDGETS = {
  perConversation: { messages: 200 },
  perIpPerDay: { tokens: 2_000_000 },
} as const satisfies Budgets;

const SCOPE_KEYS = ['perConversation', 'perIpPerDay', 'globalPerDay'] as const;

/**
 * Fills the scopes you didn't set with `DEFAULT_BUDGETS`. A scope you set
 * replaces its default whole; `false` turns it off. `false` for the whole
 * option turns budgets off and resolves `undefined`.
 */
export function withDefaultBudgets(budgets?: Budgets | false): { budgets: Budgets; defaulted: BudgetScope[] } | undefined {
  if (budgets === false) return undefined;
  const out: Budgets = { ...budgets };
  const defaulted: BudgetScope[] = [];
  if (out.perConversation === undefined) {
    out.perConversation = DEFAULT_BUDGETS.perConversation;
    defaulted.push('conversation');
  }
  if (out.perIpPerDay === undefined) {
    out.perIpPerDay = DEFAULT_BUDGETS.perIpPerDay;
    defaulted.push('ip');
  }
  return SCOPE_KEYS.some((key) => out[key]) ? { budgets: out, defaulted } : undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CONVERSATION_TTL_MS = 30 * DAY_MS;

interface Scope {
  scope: BudgetScope;
  limit: BudgetLimit & { usd?: number };
  key: string;
  ttlMs: number;
}

/**
 * Token, reply and dollar budgets on a `CounterStore`, so they hold across
 * server instances. Checked before each model request and charged after it,
 * so a reply can go over by at most one request.
 */
export function createBudgetGuard(
  counters: CounterStore,
  budgets: Budgets,
  options: { prefix?: string; now?: () => number } = {}
): BudgetGuard {
  const prefix = options.prefix ?? 'budget';
  const now = options.now ?? Date.now;
  if (budgets.globalPerDay && budgets.globalPerDay.usd !== undefined && !budgets.price) {
    throw new Error('budgets.globalPerDay.usd needs budgets.price to know what a request costs.');
  }
  for (const name of SCOPE_KEYS) {
    const limit = budgets[name];
    if (limit === undefined || limit === false) continue;
    if (typeof limit !== 'object' || limit === null) throw new Error(`budgets.${name} must be an object or false.`);
    for (const [field, value] of Object.entries(limit)) {
      if (typeof value !== 'number' || !(value > 0)) throw new Error(`budgets.${name}.${field} must be a positive number.`);
    }
  }

  function scopes(context: BudgetContext): Scope[] {
    const day = Math.floor(now() / DAY_MS);
    const out: Scope[] = [];
    if (budgets.perConversation) {
      out.push({ scope: 'conversation', limit: budgets.perConversation, key: `${prefix}:c:${context.conversationId}`, ttlMs: CONVERSATION_TTL_MS });
    }
    if (budgets.perIpPerDay && context.ip) {
      out.push({ scope: 'ip', limit: budgets.perIpPerDay, key: `${prefix}:ip:${context.ip}:${day}`, ttlMs: 2 * DAY_MS });
    }
    if (budgets.globalPerDay) {
      out.push({ scope: 'global', limit: budgets.globalPerDay, key: `${prefix}:g:${day}`, ttlMs: 2 * DAY_MS });
    }
    return out;
  }

  const used = async (key: string) => (await counters.get(key))?.value ?? 0;

  return {
    async before(context, step) {
      let tokensLeft: number | undefined;
      for (const { scope, limit, key, ttlMs } of scopes(context)) {
        if (limit.messages !== undefined && step === 1) {
          // Counted when the reply starts, atomically, so a burst can't all pass.
          const { value } = await counters.increment(`${key}:messages`, 1, ttlMs);
          if (value > limit.messages) throw new BudgetExceededError(scope);
        }
        if (limit.tokens !== undefined) {
          const left = limit.tokens - (await used(`${key}:tokens`));
          if (left <= 0) throw new BudgetExceededError(scope);
          tokensLeft = Math.min(tokensLeft ?? left, left);
        }
        if (limit.usd !== undefined && (await used(`${key}:usd`)) >= limit.usd) {
          throw new BudgetExceededError(scope);
        }
      }
      return tokensLeft === undefined ? {} : { tokensLeft };
    },

    async after(context, usage) {
      const tokens = usage.inputTokens + usage.outputTokens;
      const usd = budgets.price ? budgets.price(usage) : 0;
      await Promise.all(
        scopes(context).flatMap(({ limit, key, ttlMs }) => [
          ...(limit.tokens !== undefined && tokens > 0 ? [counters.increment(`${key}:tokens`, tokens, ttlMs)] : []),
          ...(limit.usd !== undefined && usd > 0 ? [counters.increment(`${key}:usd`, usd, ttlMs)] : []),
        ])
      );
    },
  };
}
