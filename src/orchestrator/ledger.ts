/**
 * Per-briefing record of what every model call consumed, and the budget cap.
 *
 * The orchestrator gives each stage a provider wrapped by `meter()`, so
 * every call is recorded under its stage without the agents knowing.
 *
 * With a cap, each request (`pause_turn` re-sends included) reserves its
 * worst case before it is sent: its whole `max_tokens`, every search its
 * `max_uses` allows, each search adding `TOKENS_PER_SEARCH_CEILING` tokens,
 * the prompt at `CHARS_PER_TOKEN_FLOOR` characters per token
 * (`requestCostUsd`). It is sent only if what is spent, what requests in
 * flight reserved and its own worst case fit in the cap, so concurrent
 * synthesis sections cannot all pass the check together. Once it answers it
 * is charged the usage it reports; a request that fails or reports no usage
 * (a timeout, a dropped connection, a body that cannot be read) may have been
 * billed, so it stays charged at its worst case, counted apart as
 * `unreported_usd`. The spend passes the cap only if a request costs more
 * than its worst case: searches that add more than the allowance, or text
 * that tokenizes below the floor. A request that cannot be sized (no price,
 * no `max_tokens`, a web search without `max_uses`) is not sent.
 */
import type { LLMProvider } from "../llm/provider.ts";
import type { CompletionResult, TokenUsage, Tool } from "../llm/types.ts";
import {
  CHARS_PER_TOKEN_FLOOR,
  costOf,
  DEFAULT_PRICE_TABLE,
  type PriceTable,
  requestCostUsd,
  TOKENS_PER_SEARCH_CEILING,
} from "../llm/pricing.ts";
import { BudgetExceededError } from "../llm/errors.ts";

export interface StageUsage extends TokenUsage {
  calls: number;
  /** USD; `null` when a call's model is missing from the price table. */
  cost_usd: number | null;
  models: string[];
  /** Wall-clock time of the stage, when recorded. */
  duration_ms?: number;
  /**
   * USD charged at their worst case for requests that failed or reported no
   * usage; included in `cost_usd`, absent when none.
   */
  unreported_usd?: number;
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

/**
 * A `UsageSummary` read back from a run's `metadata.json`, checked field by
 * field: a missing cost would make the spend NaN, and NaN never reaches a
 * cap.
 */
export function parseUsageSummary(value: unknown): UsageSummary {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const isCount = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0;
  if (!isObj(value) || !isObj(value["stages"])) throw new Error("'usage.stages' must be an object");
  for (const [name, s] of Object.entries(value["stages"])) {
    if (!isObj(s)) throw new Error(`'usage.stages.${name}' must be an object`);
    for (const key of [
      "calls",
      "input_tokens",
      "output_tokens",
      "cache_creation_input_tokens",
      "cache_read_input_tokens",
      "web_search_requests",
    ]) {
      if (!isCount(s[key])) throw new Error(`'usage.stages.${name}.${key}' must be a non-negative number`);
    }
    if (s["cost_usd"] !== null && !isCount(s["cost_usd"])) {
      throw new Error(`'usage.stages.${name}.cost_usd' must be a non-negative number or null`);
    }
    if (!Array.isArray(s["models"]) || !s["models"].every((m) => typeof m === "string")) {
      throw new Error(`'usage.stages.${name}.models' must be an array of strings`);
    }
    for (const key of ["duration_ms", "unreported_usd"]) {
      if (s[key] !== undefined && !isCount(s[key])) {
        throw new Error(`'usage.stages.${name}.${key}' must be a non-negative number`);
      }
    }
  }
  return value as unknown as UsageSummary;
}

export class UsageLedger {
  private readonly prices: PriceTable;
  private readonly maxCostUsd: number | undefined;
  private readonly simulated: boolean;
  private readonly stages = new Map<string, StageUsage>();
  private spent = 0;
  private reserved = 0;
  private unpriced: string | undefined;

  constructor(options: UsageLedgerOptions = {}) {
    this.prices = options.prices ?? DEFAULT_PRICE_TABLE;
    const cap = options.maxCostUsd;
    // `spent >= cap` is never true for NaN or Infinity: such a cap would
    // silently allow any spend.
    if (cap !== undefined && !(Number.isFinite(cap) && cap > 0)) {
      throw new RangeError(`maxCostUsd must be a positive finite number, got ${cap}`);
    }
    this.maxCostUsd = cap;
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

  /**
   * Throws `BudgetExceededError` when the cap is spent. `pendingUsd`: spent
   * by a call still running, not yet recorded.
   */
  assertWithinBudget(stage: string, pendingUsd = 0): void {
    if (this.maxCostUsd === undefined) return;
    if (this.unpriced !== undefined) {
      throw new BudgetExceededError(
        this.spent,
        this.maxCostUsd,
        stage,
        `model '${this.unpriced}' has no price, so the cap cannot be enforced`
      );
    }
    if (this.spent + pendingUsd >= this.maxCostUsd) {
      throw new BudgetExceededError(this.spent + pendingUsd, this.maxCostUsd, stage);
    }
  }

  /** Whether a cap is set. */
  get capped(): boolean {
    return this.maxCostUsd !== undefined;
  }

  /**
   * USD a request costs at most (see the file comment), or `undefined` when
   * its model has no price.
   */
  worstCaseUsd(
    model: string,
    request: { promptChars: number; maxTokens: number; maxSearches: number; resentTokens?: number }
  ): number | undefined {
    const cost = requestCostUsd(
      {
        promptTokens: Math.ceil(request.promptChars / CHARS_PER_TOKEN_FLOOR) + (request.resentTokens ?? 0),
        outputTokens: request.maxTokens,
        searches: request.maxSearches,
        tokensPerSearch: TOKENS_PER_SEARCH_CEILING,
      },
      model,
      this.prices
    );
    return cost ?? undefined;
  }

  /**
   * Holds `usd` for a request about to be sent, or throws
   * `BudgetExceededError` when spent + reserved + `pendingUsd` (answered, not
   * yet recorded) + `usd` exceeds the cap. A no-op without a cap.
   */
  reserve(stage: string, usd: number, pendingUsd = 0): void {
    if (this.maxCostUsd === undefined) return;
    this.assertWithinBudget(stage, pendingUsd);
    const committed = this.spent + this.reserved + pendingUsd;
    // Sums of float dollars drift by ~1e-18; a request exactly at the cap fits.
    if (committed + usd > this.maxCostUsd + 1e-12) {
      throw new BudgetExceededError(
        committed,
        this.maxCostUsd,
        stage,
        `the next request may cost up to $${usd.toFixed(4)}, and $${committed.toFixed(4)} is spent or held by requests in flight`
      );
    }
    this.reserved += usd;
  }

  /** The error that stops a request whose cost the cap cannot bound. */
  refusal(stage: string, reason: string): BudgetExceededError {
    return new BudgetExceededError(this.spent, this.maxCostUsd ?? 0, stage, reason);
  }

  /** Returns what `reserve` held. */
  release(usd: number): void {
    if (this.maxCostUsd === undefined) return;
    this.reserved -= usd;
  }

  /**
   * Adds `usd` to the call `record` just counted under `stage`, for its
   * request that failed or reported no usage.
   */
  chargeUnreported(stage: string, model: string, usd: number): void {
    const entry = this.stage(stage);
    if (entry.cost_usd !== null) entry.cost_usd += usd;
    if (!entry.models.includes(model)) entry.models.push(model);
    entry.unreported_usd = (entry.unreported_usd ?? 0) + usd;
    this.spent += usd;
  }

  /** USD for `usage` on `model` under this ledger's prices; 0 when unpriced. */
  costOf(usage: TokenUsage, model: string): number {
    return costOf(usage, model, this.prices) ?? 0;
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
      const { calls, cost_usd, models, duration_ms, unreported_usd, ...tokens } = s;
      entry.calls += calls;
      entry.input_tokens += tokens.input_tokens;
      entry.output_tokens += tokens.output_tokens;
      entry.cache_creation_input_tokens += tokens.cache_creation_input_tokens;
      entry.cache_read_input_tokens += tokens.cache_read_input_tokens;
      entry.web_search_requests += tokens.web_search_requests;
      entry.cost_usd = entry.cost_usd === null || cost_usd === null ? null : entry.cost_usd + cost_usd;
      for (const m of models) if (!entry.models.includes(m)) entry.models.push(m);
      if (duration_ms !== undefined) entry.duration_ms = (entry.duration_ms ?? 0) + duration_ms;
      if (unreported_usd !== undefined) entry.unreported_usd = (entry.unreported_usd ?? 0) + unreported_usd;
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
      if (s.unreported_usd !== undefined) total.unreported_usd = (total.unreported_usd ?? 0) + s.unreported_usd;
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

/** Total `max_uses` of the request's web searches; `undefined` when one has none. */
function searchCap(tools: readonly Tool[]): number | undefined {
  let total = 0;
  for (const tool of tools) {
    if (tool.type !== "web_search") continue;
    if (tool.max_uses === undefined) return undefined;
    total += tool.max_uses;
  }
  return total;
}

/**
 * `inner`, with every call checked against the budget and recorded under
 * `stage` (see the file comment for the cap). Only `completeWithTools`
 * returns usage, so a provider without it is passed through and its calls
 * are recorded with zero usage.
 */
export function meter(inner: LLMProvider, ledger: UsageLedger, stage: string): LLMProvider {
  /** The worst case of one request, or a `BudgetExceededError` saying why it has none. */
  const worstCase = (
    model: string,
    promptChars: number,
    maxTokens: number | undefined,
    maxSearches: number | undefined,
    resentTokens = 0
  ): number => {
    const refuse = (reason: string) => ledger.refusal(stage, reason);
    if (maxTokens === undefined) throw refuse("the request sets no max_tokens, so its cost has no bound");
    if (maxSearches === undefined) throw refuse("a web search without max_uses has no bound on its cost");
    const usd = ledger.worstCaseUsd(model, { promptChars, maxTokens, maxSearches, resentTokens });
    if (usd === undefined) throw refuse(`model '${model}' has no price, so the cap cannot be enforced`);
    return usd;
  };

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
      const promptChars = prompt.length + (options?.system?.length ?? 0);
      const maxTokens = options?.max_tokens;
      const maxSearches = searchCap(tools);
      let model = options?.model ?? "unknown";
      let answered: TokenUsage | undefined;
      let held = 0;
      let round = 0;
      const hold = (usd: number, pendingUsd = 0) => {
        ledger.release(held);
        held = 0;
        ledger.reserve(stage, usd, pendingUsd);
        held = usd;
      };
      // Reserved before the provider is called, so a provider that never
      // calls before_request is still capped, and concurrent calls reserve
      // in the order they start.
      if (ledger.capped) hold(worstCase(model, promptChars, maxTokens, maxSearches));
      let result: CompletionResult;
      try {
        result = await withTools(prompt, tools, {
          ...options,
          before_request: (soFar, sentTo) => {
            answered = soFar;
            const firstModel = model;
            model = sentTo;
            const resend = round++ > 0;
            if (!ledger.capped || (!resend && sentTo === firstModel)) return;
            // A re-send carries the earlier rounds back: at most their
            // prompts, searches and outputs, sized by the same allowances.
            const perRound = TOKENS_PER_SEARCH_CEILING * (maxSearches ?? 0) + (maxTokens ?? 0);
            const resent = (round - 1) * perRound;
            hold(worstCase(sentTo, promptChars, maxTokens, maxSearches, resent), ledger.costOf(soFar, sentTo));
          },
        });
      } catch (err) {
        // The answered requests were billed at what they reported; the one in
        // flight may have been billed and reported nothing, so it stays at its
        // worst case. Then the error goes through unchanged.
        const unreported = held;
        ledger.release(held);
        if (unreported > 0) {
          ledger.record(stage, model, answered);
          ledger.chargeUnreported(stage, model, unreported);
        } else if (answered !== undefined && answered.input_tokens + answered.output_tokens > 0) {
          ledger.record(stage, model, answered);
        }
        throw err;
      }
      ledger.release(held);
      ledger.record(stage, result.model ?? model, result.usage);
      if (result.usage === undefined && held > 0) ledger.chargeUnreported(stage, model, held);
      return result;
    };
  }
  return wrapped;
}
