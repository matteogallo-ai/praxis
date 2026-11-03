/**
 * The budget cap as a limit: each request reserves its worst case before it
 * is sent (its whole `max_tokens`, every search its `max_uses` allows, each
 * search adding `TOKENS_PER_SEARCH_CEILING` tokens of context), and a request
 * that fails or reports no usage stays charged at that worst case.
 *
 * Runs the real Anthropic provider on a fake fetch: nothing leaves the
 * machine. The worst cases are worked out by hand in each test.
 */
import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider, type FetchLike } from "../../src/llm/anthropic-provider.ts";
import { AnthropicTimeoutError, BudgetExceededError } from "../../src/llm/errors.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";
import type { Tool } from "../../src/llm/types.ts";
import { meter, parseUsageSummary, UsageLedger } from "../../src/orchestrator/ledger.ts";

const SONNET = "claude-sonnet-5-5";
const SEARCH: Tool = { type: "web_search", name: "web_search", max_uses: 5 };
// System "S" and prompt "U": 2 characters, 1 token at the 2.5-character floor.
// Sonnet 5.5 at $2 / $10 per million, $10 per 1000 searches, 16 000 max_tokens,
// 5 searches of 15 000 tokens, the context re-read after each search, and the
// whole output written before the first search so all 5 later rounds re-read it:
//   input  = 6 × 1 + 15 000 × 15 + 16 000 × 5 = 305 006 tokens → $0.610012
//   output = 16 000 tokens                                     → $0.16
//   search = 5                                                 → $0.05
const WORST_ROUND_0 = 0.820012;
// A pause_turn re-send carries the first round's context back: at most the
// prompt, its 5 searches and its output, 1 + 75 000 + 16 000 = 91 001 tokens.
//   input = 6 × 91 001 + 225 000 + 80 000 = 851 006 tokens → $1.702012
const WORST_ROUND_1 = 1.702012 + 0.16 + 0.05;
// The same request on Opus 5.5 ($4 / $20): 305 006 × 4 + 16 000 × 20 → $1.540024 + $0.05.
const WORST_ROUND_0_OPUS = 1.590024;
const OPTIONS = { model: SONNET, system: "S", max_tokens: 16_000 };

function answer(stop = "end_turn", input = 1000, output = 500) {
  return {
    model: SONNET,
    content: [{ type: "text", text: "{}" }],
    stop_reason: stop,
    usage: { input_tokens: input, output_tokens: output },
  };
}

function provider(fetchFn: FetchLike): AnthropicLLMProvider {
  return new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn, sleepFn: async () => {}, maxAttempts: 1 });
}

function counting(bodies: unknown[]): { fetchFn: FetchLike; sent: () => number } {
  let sent = 0;
  const fetchFn: FetchLike = async () => new Response(JSON.stringify(bodies[sent++]), { status: 200 });
  return { fetchFn, sent: () => sent };
}

const timesOut: FetchLike = async () => {
  throw new DOMException("aborted", "AbortError");
};

describe("each request reserves its worst case before it is sent", () => {
  test("a request whose worst case does not fit in the cap is not sent", async () => {
    const { fetchFn, sent } = counting([answer()]);
    const ledger = new UsageLedger({ maxCostUsd: 0.82 });
    const err = await meter(provider(fetchFn), ledger, "risk")
      .completeWithTools?.("U", [SEARCH], OPTIONS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as Error).message).toContain("$0.8200");
    expect(sent()).toBe(0);
  });

  test("a request whose worst case fits exactly is sent", async () => {
    const { fetchFn, sent } = counting([answer()]);
    const ledger = new UsageLedger({ maxCostUsd: WORST_ROUND_0 });
    await meter(provider(fetchFn), ledger, "risk").completeWithTools?.("U", [SEARCH], OPTIONS);
    expect(sent()).toBe(1);
  });

  test("a completed request is charged what it reported, and its reservation is released", async () => {
    const { fetchFn, sent } = counting([answer(), answer()]);
    const ledger = new UsageLedger({ maxCostUsd: 1 });
    const metered = meter(provider(fetchFn), ledger, "risk");
    await metered.completeWithTools?.("U", [SEARCH], OPTIONS);
    // 1000 input + 500 output on Sonnet: $0.007.
    expect(ledger.summary().total.cost_usd).toBeCloseTo(0.007, 10);
    await metered.completeWithTools?.("U", [SEARCH], OPTIONS);
    expect(sent()).toBe(2);
  });

  test("concurrent requests cannot all pass the check together", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let sent = 0;
    const fetchFn: FetchLike = async () => {
      sent++;
      await gate;
      return new Response(JSON.stringify(answer()), { status: 200 });
    };
    // Room for one worst case, not two.
    const ledger = new UsageLedger({ maxCostUsd: 1.5 });
    const first = meter(provider(fetchFn), ledger, "synthesis").completeWithTools?.("U", [SEARCH], OPTIONS);
    const second = meter(provider(fetchFn), ledger, "synthesis")
      .completeWithTools?.("U", [SEARCH], OPTIONS)
      .catch((e: unknown) => e);
    expect(await second).toBeInstanceOf(BudgetExceededError);
    release();
    await first;
    expect(sent).toBe(1);
  });

  test("a pause_turn re-send reserves its own, larger worst case", async () => {
    const { fetchFn, sent } = counting([answer("pause_turn"), answer()]);
    // Room for the first round, its reported cost ($0.007) and less than the second worst case.
    const ledger = new UsageLedger({ maxCostUsd: 0.007 + WORST_ROUND_1 - 0.001 });
    const err = await meter(provider(fetchFn), ledger, "risk")
      .completeWithTools?.("U", [SEARCH], OPTIONS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(sent()).toBe(1);
    // The answered round is recorded at what it reported.
    expect(ledger.summary().total.cost_usd).toBeCloseTo(0.007, 10);
  });

  test("a pinned model is reserved at its own price before the first request, and a refusal charges nothing", async () => {
    let sent = 0;
    const fetchFn: FetchLike = async () => {
      sent++;
      return new Response(JSON.stringify(answer()), { status: 200 });
    };
    const pinned = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn, model: "claude-opus-5-5", maxAttempts: 1 });
    // Room for the Sonnet worst case the stage asks for, not the Opus one it gets.
    const ledger = new UsageLedger({ maxCostUsd: (WORST_ROUND_0 + WORST_ROUND_0_OPUS) / 2 });
    const err = await meter(pinned, ledger, "risk")
      .completeWithTools?.("U", [SEARCH], OPTIONS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(sent).toBe(0);
    expect(ledger.summary().total).toMatchObject({ calls: 0, cost_usd: 0 });
  });

  test("a pinned model without a price is refused before the first request, and charges nothing", async () => {
    const { fetchFn, sent } = counting([answer()]);
    const pinned = new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn, model: "claude-unpriced-x", maxAttempts: 1 });
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    const err = await meter(pinned, ledger, "risk")
      .completeWithTools?.("U", [SEARCH], OPTIONS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(sent()).toBe(0);
    expect(ledger.summary().total).toMatchObject({ calls: 0, cost_usd: 0 });
  });

  test("a web search without max_uses cannot be capped, so it is not sent", async () => {
    const { fetchFn, sent } = counting([answer()]);
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    const err = await meter(provider(fetchFn), ledger, "risk")
      .completeWithTools?.("U", [{ type: "web_search", name: "web_search" }], OPTIONS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as Error).message).toContain("max_uses");
    expect(sent()).toBe(0);
  });

  test("a request without max_tokens cannot be capped, so it is not sent", async () => {
    const { fetchFn, sent } = counting([answer()]);
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    const err = await meter(provider(fetchFn), ledger, "risk")
      .completeWithTools?.("U", [SEARCH], { model: SONNET, system: "S" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as Error).message).toContain("max_tokens");
    expect(sent()).toBe(0);
  });
});

describe("a request that reports no usage is charged its worst case", () => {
  test("a timed-out request counts against the cap at its worst case", async () => {
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    const err = await meter(provider(timesOut), ledger, "risk")
      .completeWithTools?.("U", [SEARCH], OPTIONS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnthropicTimeoutError);
    const risk = ledger.summary().stages["risk"];
    expect(risk?.cost_usd).toBeCloseTo(WORST_ROUND_0, 10);
    expect(risk?.unreported_usd).toBeCloseTo(WORST_ROUND_0, 10);
    // Reported tokens stay what the provider reported: none.
    expect(risk?.input_tokens).toBe(0);
  });

  test("a request refused with an HTTP error was not billed, so it is charged nothing", async () => {
    const fetchFn: FetchLike = async () => new Response('{"error":"bad"}', { status: 400 });
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    await meter(provider(fetchFn), ledger, "risk")
      .completeWithTools?.("U", [SEARCH], OPTIONS)
      .catch(() => undefined);
    expect(ledger.summary().total.cost_usd).toBe(0);
  });

  test("after a timeout the reservation is released: a second request that fits beside the charge is sent", async () => {
    let sent = 0;
    const fetchFn: FetchLike = async (...args) => {
      sent++;
      return timesOut(...args);
    };
    // Two worst cases fit; a leaked reservation would make it three.
    const ledger = new UsageLedger({ maxCostUsd: 2 * WORST_ROUND_0 + 0.1 });
    const metered = meter(provider(fetchFn), ledger, "risk");
    await metered.completeWithTools?.("U", [SEARCH], OPTIONS).catch(() => undefined);
    await metered.completeWithTools?.("U", [SEARCH], OPTIONS).catch(() => undefined);
    expect(sent).toBe(2);
    expect(ledger.summary().total.unreported_usd).toBeCloseTo(2 * WORST_ROUND_0, 10);
  });

  test("after a timeout, a retry that no longer fits is not sent", async () => {
    let sent = 0;
    const fetchFn: FetchLike = async (...args) => {
      sent++;
      return timesOut(...args);
    };
    const ledger = new UsageLedger({ maxCostUsd: 1 });
    const metered = meter(provider(fetchFn), ledger, "risk");
    await metered.completeWithTools?.("U", [SEARCH], OPTIONS).catch(() => undefined);
    const err = await metered.completeWithTools?.("U", [SEARCH], OPTIONS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(sent).toBe(1);
  });

  test("a complete()-only provider is charged its worst case under a cap", async () => {
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    const plain: LLMProvider = { name: "plain", complete: async () => "{}" };
    await meter(plain, ledger, "scoping").complete("U", { model: SONNET, max_tokens: 8_000 });
    // 1 input token, 8 000 output tokens on Sonnet: $0.000002 + $0.08.
    expect(ledger.summary().stages["scoping"]?.cost_usd).toBeCloseTo(0.080002, 10);
  });
});

describe("unreported_usd survives the run record", () => {
  test("it is summed in the total, read back by parseUsageSummary and restored on resume", async () => {
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    await meter(provider(timesOut), ledger, "risk")
      .completeWithTools?.("U", [SEARCH], OPTIONS)
      .catch(() => undefined);
    const saved = parseUsageSummary(JSON.parse(JSON.stringify(ledger.summary())));
    expect(saved.total.unreported_usd).toBeCloseTo(WORST_ROUND_0, 10);
    const resumed = new UsageLedger({ maxCostUsd: 100 });
    resumed.restore(saved);
    expect(resumed.summary().stages["risk"]?.unreported_usd).toBeCloseTo(WORST_ROUND_0, 10);
    // Restored spend counts against the cap.
    const tight = new UsageLedger({ maxCostUsd: WORST_ROUND_0 * 1.5 });
    tight.restore(saved);
    const { fetchFn, sent } = counting([answer()]);
    const err = await meter(provider(fetchFn), tight, "risk")
      .completeWithTools?.("U", [SEARCH], OPTIONS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect(sent()).toBe(0);
  });

  test("a negative unreported_usd in a run record is refused", () => {
    const summary = new UsageLedger().summary();
    const bad = { ...summary, stages: { risk: { ...summary.total, unreported_usd: -1 } } };
    expect(() => parseUsageSummary(bad)).toThrow(/unreported_usd/);
  });
});
