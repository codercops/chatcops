/** US dollars per million tokens, by model id: `{ 'gpt-5-mini': { input: 0.25, output: 2 } }`. */
export type Prices = Record<string, { input: number; output: number }>;

/** What `usage` cost on `model`, or undefined when there's no price for it. */
export function costOf(model: string | undefined, usage: { inputTokens: number; outputTokens: number } | undefined, prices: Prices | undefined): number | undefined {
  const price = model ? prices?.[model] : undefined;
  if (!price || !usage) return undefined;
  return (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000;
}

/**
 * What a run has spent, against `--max-cost`. Replays spend nothing, so
 * they never count. The check runs before each turn, so a run can go over
 * by what the turns already in flight cost.
 */
export class Spend {
  spent = 0;
  constructor(
    readonly max: number | undefined,
    private readonly counting: boolean
  ) {}

  add(costUsd: number | undefined): void {
    if (this.counting && costUsd) this.spent += costUsd;
  }

  get exceeded(): boolean {
    return this.max !== undefined && this.spent >= this.max;
  }
}

/** `$0.0123`, with enough digits for small amounts. */
export function dollars(amount: number): string {
  return `$${amount.toFixed(amount < 1 ? 4 : 2)}`;
}
