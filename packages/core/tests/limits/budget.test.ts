import { describe, expect, it } from 'vitest';
import { runTurn } from '../../src/agent/run-turn.js';
import { BudgetExceededError, DEFAULT_BUDGETS, createBudgetGuard, withDefaultBudgets } from '../../src/limits/budget.js';
import type { WirePart } from '../../src/protocol/v1.js';
import { memoryStorage } from '../../src/storage/memory.js';
import { scriptedProvider, textStep } from '../../src/testing/provider.js';
import type { CounterStore } from '../../src/storage/types.js';

const counters = () => memoryStorage().counters as CounterStore;
const usage = (inputTokens: number, outputTokens: number) => ({ inputTokens, outputTokens });
const c1 = { conversationId: 'c1', ip: '1.2.3.4' };

describe('createBudgetGuard', () => {
  it('stops a conversation once its tokens are used up, and says how many are left before that', async () => {
    const guard = createBudgetGuard(counters(), { perConversation: { tokens: 1000 } });
    expect(await guard.before(c1, 1)).toEqual({ tokensLeft: 1000 });
    await guard.after(c1, usage(700, 100));
    expect(await guard.before(c1, 2)).toEqual({ tokensLeft: 200 });
    await guard.after(c1, usage(150, 60));
    await expect(guard.before(c1, 3)).rejects.toEqual(new BudgetExceededError('conversation'));
    // Another conversation has its own budget.
    expect(await guard.before({ conversationId: 'c2' }, 1)).toEqual({ tokensLeft: 1000 });
  });

  it('counts replies when they start, and only on the first step', async () => {
    const guard = createBudgetGuard(counters(), { perConversation: { messages: 2 } });
    await guard.before(c1, 1);
    await guard.before(c1, 2);
    await guard.before(c1, 1);
    await expect(guard.before(c1, 1)).rejects.toMatchObject({ scope: 'conversation' });
  });

  it('limits an IP per UTC day, and skips that limit when the IP is unknown', async () => {
    let now = Date.UTC(2026, 9, 21, 23, 0);
    const guard = createBudgetGuard(counters(), { perIpPerDay: { tokens: 100 } }, { now: () => now });
    await guard.after(c1, usage(100, 0));
    await expect(guard.before({ conversationId: 'other', ip: '1.2.3.4' }, 1)).rejects.toMatchObject({ scope: 'ip' });
    expect(await guard.before({ conversationId: 'other' }, 1)).toEqual({});
    now += 2 * 60 * 60 * 1000; // the next UTC day
    expect(await guard.before(c1, 1)).toEqual({ tokensLeft: 100 });
  });

  it('stops everything at the daily dollar cap, priced by the given function', async () => {
    const price = (u: { inputTokens: number; outputTokens: number }) => (u.inputTokens * 1 + u.outputTokens * 5) / 1_000_000;
    const guard = createBudgetGuard(counters(), { globalPerDay: { usd: 0.01 }, price });
    await guard.after(c1, usage(5_000, 1_000)); // $0.01
    await expect(guard.before({ conversationId: 'anyone' }, 1)).rejects.toMatchObject({ scope: 'global' });
  });

  it('refuses a dollar cap without a price, and limits that are not positive', () => {
    expect(() => createBudgetGuard(counters(), { globalPerDay: { usd: 5 } })).toThrow('needs budgets.price');
    expect(() => createBudgetGuard(counters(), { perConversation: { tokens: 0 } })).toThrow('budgets.perConversation.tokens must be a positive number.');
  });
});

describe('runTurn with a budget', () => {
  async function parts(turn: AsyncGenerator<WirePart>) {
    const out: WirePart[] = [];
    for await (const part of turn) out.push(part);
    return out;
  }

  it('ends the reply with budget_exceeded before asking the model', async () => {
    const guard = createBudgetGuard(counters(), { perConversation: { tokens: 10 } });
    await guard.after(c1, usage(10, 0));
    const provider = scriptedProvider([textStep('never')]);
    const out = await parts(
      runTurn({ provider, messages: [], systemPrompt: 's', conversationId: 'c1', budget: { guard, context: c1 } })
    );
    expect(provider.calls).toHaveLength(0);
    expect(out.slice(-2)).toEqual([
      { type: 'error', code: 'budget_exceeded', retryable: false, scope: 'conversation' },
      { type: 'finish', reason: 'error' },
    ]);
  });

  it('charges each step and caps the reply length to what is left', async () => {
    const store = counters();
    const guard = createBudgetGuard(store, { perConversation: { tokens: 1_000 } });
    await guard.after(c1, usage(700, 0));
    const provider = scriptedProvider([textStep('ok', { usage: usage(40, 2) })]);
    await parts(runTurn({ provider, messages: [], systemPrompt: 's', conversationId: 'c1', maxTokens: 4096, budget: { guard, context: c1 } }));

    expect(provider.calls[0].maxTokens).toBe(300);
    expect((await store.get('budget:c:c1:tokens'))?.value).toBe(742);
  });

  it('never caps a reply below a usable length', async () => {
    const guard = createBudgetGuard(counters(), { perConversation: { tokens: 1_000 } });
    await guard.after(c1, usage(990, 0));
    const provider = scriptedProvider([textStep('ok')]);
    await parts(runTurn({ provider, messages: [], systemPrompt: 's', conversationId: 'c1', budget: { guard, context: c1 } }));
    expect(provider.calls[0].maxTokens).toBe(256);
  });
});

describe('withDefaultBudgets', () => {
  it('fills the scopes you leave out, and says which ones', () => {
    expect(withDefaultBudgets()).toEqual({ budgets: DEFAULT_BUDGETS, defaulted: ['conversation', 'ip'] });
    expect(withDefaultBudgets({ perIpPerDay: { tokens: 500_000 }, globalPerDay: { messages: 10_000 } })).toEqual({
      budgets: { perConversation: DEFAULT_BUDGETS.perConversation, perIpPerDay: { tokens: 500_000 }, globalPerDay: { messages: 10_000 } },
      defaulted: ['conversation'],
    });
  });

  it('replaces a default whole rather than merging into it', () => {
    expect(withDefaultBudgets({ perConversation: { tokens: 50_000 } })?.budgets.perConversation).toEqual({ tokens: 50_000 });
  });

  it('turns a scope off with false, and everything off with false', () => {
    expect(withDefaultBudgets({ perConversation: false })).toEqual({
      budgets: { perConversation: false, perIpPerDay: DEFAULT_BUDGETS.perIpPerDay },
      defaulted: ['ip'],
    });
    expect(withDefaultBudgets({ perConversation: false, perIpPerDay: false })).toBeUndefined();
    expect(withDefaultBudgets(false)).toBeUndefined();
  });

  it('gives a guard that skips the scopes turned off', async () => {
    const guard = createBudgetGuard(counters(), { perConversation: false, perIpPerDay: { tokens: 100 }, globalPerDay: false });
    await guard.after(c1, usage(100, 0));
    await expect(guard.before(c1, 1)).rejects.toEqual(new BudgetExceededError('ip'));
    expect(await guard.before({ conversationId: 'c1', ip: '5.6.7.8' }, 1)).toEqual({ tokensLeft: 100 });
  });

  it('still refuses a scope that is not an object', () => {
    expect(() => createBudgetGuard(counters(), { perConversation: 5 as never })).toThrow('budgets.perConversation must be an object or false.');
  });
});
