/**
 * Per-briefing record of what every model call consumed, and the budget cap.
 *
 * The orchestrator gives each stage a provider wrapped by `meter()`, so
 * every call is recorded under its stage without the agents knowing. The
 * cap is checked before each call: once the briefing has spent `maxCostUsd`
 * no further call starts. A call's cost is known only after it returns, so
 * a briefing can end above the cap by the cost of the calls already in
 * flight when it was reached: one call, or one per section while synthesis
 * sections run concurrently. With a cap set, a call whose model has no
 * price stops the run, since the cap could no longer be enforced. A request
 * that times out is billed by the server but reports no usage, so it is not
 * counted.
 */
import type { LLMProvider } from "../llm/provider.ts";
import type { CompletionResult, TokenUsage } from "../llm/types.ts";
import { costOf, DEFAULT_PRICE_TABLE, type PriceTable } from "../llm/pricing.ts";
import { BudgetExceededError } from "../llm/errors.ts";

export interface StageUsage extends TokenUsage {
  calls: number;
  /** USD; `null` when a call's model is missing from the price table. */
  cost_usd: number | null;
  models: string[];
  /** Wall-clock time of the stage, when recorded. */
  duration_ms?: number;
}

export interface UsageSummary {
  stages: Record<string, StageUsage>;
  total: StageUsage;
  /** True when the provider simulated usage (mock): not a real cost. */
  simulated: boolean;
  max_cost_usd: number | null;
}

export interface UsageLedgerOptions {
  prices?: PriceTable;
  /** Stop starting calls once this many USD are spent. */
  maxCostUsd?: number;
  /** Set for the mock provider, whose usage is computed from text length. */
  simulated?: boolean;
}

function emptyStage(): StageUsage {
  return {
    calls: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: 0,
    cost_usd: 0,
    models: [],
  };
}

function add(into: StageUsage, usage: TokenUsage, model: string, cost: number | null): void {
  into.calls += 1;
  into.input_tokens += usage.input_tokens;
  into.output_tokens += usage.output_tokens;
  into.cache_creation_input_tokens += usage.cache_creation_input_tokens;
  into.cache_read_input_tokens += usage.cache_read_input_tokens;
  into.web_search_requests += usage.web_search_requests;
  into.cost_usd = into.cost_usd === null || cost === null ? null : into.cost_usd + cost;
  if (!into.models.includes(model)) into.models.push(model);
}

const NO_USAGE: TokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  web_search_requests: 0,
};

export class UsageLedger {
  private readonly prices: PriceTable;
  private readonly maxCostUsd: number | undefined;
  private readonly simulated: boolean;
  private readonly stages = new Map<string, StageUsage>();
  private spent = 0;
  private unpriced: string | undefined;

  constructor(options: UsageLedgerOptions = {}) {
    this.prices = options.prices ?? DEFAULT_PRICE_TABLE;
    this.maxCostUsd = options.maxCostUsd;
    this.simulated = options.simulated ?? false;
  }

  private stage(name: string): StageUsage {
    let entry = this.stages.get(name);
    if (entry === undefined) {
      entry = emptyStage();
      this.stages.set(name, entry);
    }
    return entry;
  }

  /** Throws `BudgetExceededError` when the cap is already spent. */
  assertWithinBudget(stage: string): void {
    if (this.maxCostUsd === undefined) return;
    if (this.unpriced !== undefined) {
      throw new BudgetExceededError(
        this.spent,
        this.maxCostUsd,
        stage,
        `model '${this.unpriced}' has no price, so the cap cannot be enforced`
      );
    }
    if (this.spent >= this.maxCostUsd) {
      throw new BudgetExceededError(this.spent, this.maxCostUsd, stage);
    }
  }

  record(stage: string, model: string, usage: TokenUsage | undefined): void {
    const cost = costOf(usage ?? NO_USAGE, model, this.prices);
    add(this.stage(stage), usage ?? NO_USAGE, model, cost);
    if (cost !== null) this.spent += cost;
    else if (usage !== undefined) this.unpriced ??= model;
  }

  /**
   * Adds what earlier attempts of the same run recorded, so a resumed run
   * reports, and is capped on, the whole briefing's spend.
   */
  restore(previous: UsageSummary): void {
    for (const [name, s] of Object.entries(previous.stages)) {
      const entry = this.stage(name);
      const { calls, cost_usd, models, duration_ms, ...tokens } = s;
      entry.calls += calls;
      entry.input_tokens += tokens.input_tokens;
      entry.output_tokens += tokens.output_tokens;
      entry.cache_creation_input_tokens += tokens.cache_creation_input_tokens;
      entry.cache_read_input_tokens += tokens.cache_read_input_tokens;
      entry.web_search_requests += tokens.web_search_requests;
      entry.cost_usd = entry.cost_usd === null || cost_usd === null ? null : entry.cost_usd + cost_usd;
      for (const m of models) if (!entry.models.includes(m)) entry.models.push(m);
      if (duration_ms !== undefined) entry.duration_ms = (entry.duration_ms ?? 0) + duration_ms;
      if (cost_usd !== null) this.spent += cost_usd;
    }
  }

  recordDuration(stage: string, ms: number): void {
    const entry = this.stage(stage);
    entry.duration_ms = (entry.duration_ms ?? 0) + ms;
  }

  /** Per-stage and total usage; durations are left out when `withDurations` is false. */
  summary(withDurations = true): UsageSummary {
    const total = emptyStage();
    const stages: Record<string, StageUsage> = {};
    for (const [name, s] of this.stages) {
      const copy: StageUsage = { ...s, models: [...s.models] };
      if (!withDurations) delete copy.duration_ms;
      stages[name] = copy;
      total.calls += s.calls;
      total.input_tokens += s.input_tokens;
      total.output_tokens += s.output_tokens;
      total.cache_creation_input_tokens += s.cache_creation_input_tokens;
      total.cache_read_input_tokens += s.cache_read_input_tokens;
      total.web_search_requests += s.web_search_requests;
      total.cost_usd = total.cost_usd === null || s.cost_usd === null ? null : total.cost_usd + s.cost_usd;
      for (const m of s.models) if (!total.models.includes(m)) total.models.push(m);
      if (withDurations && s.duration_ms !== undefined) {
        total.duration_ms = (total.duration_ms ?? 0) + s.duration_ms;
      }
    }
    return {
      stages,
      total,
      simulated: this.simulated,
      max_cost_usd: this.maxCostUsd ?? null,
    };
  }
}

/**
 * `inner`, with every call checked against the budget and recorded under
 * `stage`. Only `completeWithTools` returns usage, so a provider without it
 * is passed through and its calls are recorded with zero usage.
 */
export function meter(inner: LLMProvider, ledger: UsageLedger, stage: string): LLMProvider {
  const wrapped: LLMProvider = {
    name: inner.name,
    ...(inner.acceptsSystemPrompt === undefined
      ? {}
      : { acceptsSystemPrompt: inner.acceptsSystemPrompt }),
    complete: async (prompt, options) => {
      ledger.assertWithinBudget(stage);
      const text = await inner.complete(prompt, options);
      ledger.record(stage, options?.model ?? "unknown", undefined);
      return text;
    },
  };
  const withTools = inner.completeWithTools?.bind(inner);
  if (withTools !== undefined) {
    wrapped.completeWithTools = async (prompt, tools, options): Promise<CompletionResult> => {
      ledger.assertWithinBudget(stage);
      const result = await withTools(prompt, tools, options);
      ledger.record(stage, result.model ?? options?.model ?? "unknown", result.usage);
      return result;
    };
  }
  return wrapped;
}
