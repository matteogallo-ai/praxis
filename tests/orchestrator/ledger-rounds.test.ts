/**
 * The cost cap inside one web-search call: the provider re-sends the
 * conversation after each `pause_turn`, and each re-send is a paid request.
 * The cap must be checked before every request, not once per call, and the
 * requests already answered must be recorded even when the call fails.
 */
import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { BudgetExceededError } from "../../src/llm/errors.ts";
import { meter, UsageLedger } from "../../src/orchestrator/ledger.ts";

/** One paused round: 1M input tokens of Sonnet 5.5, $2. */
const PAUSED = {
  model: "claude-sonnet-5-5",
  content: [{ type: "text", text: "searching" }],
  stop_reason: "pause_turn",
  usage: { input_tokens: 1_000_000, output_tokens: 0 },
};
const DONE = { ...PAUSED, stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };

function provider(bodies: Array<{ status: number; body: unknown }>): { p: AnthropicLLMProvider; sent: () => number } {
  let n = 0;
  const fetchFn = async () => {
    const next = bodies[n++];
    if (next === undefined) throw new Error("no scripted response");
    return new Response(JSON.stringify(next.body), { status: next.status });
  };
  return { p: new AnthropicLLMProvider({ apiKey: "sk-test", fetchFn, sleepFn: async () => {} }), sent: () => n };
}

const SEARCH = [{ type: "web_search" as const, name: "web_search" }];

describe("meter — cap checked before every request of a call", () => {
  test("a pause_turn re-send is not sent once the rounds already answered reach the cap", async () => {
    const { p, sent } = provider([{ status: 200, body: PAUSED }, { status: 200, body: DONE }]);
    const ledger = new UsageLedger({ maxCostUsd: 1 });
    const metered = meter(p, ledger, "research");
    await expect(
      metered.completeWithTools?.("q", SEARCH, { model: "claude-sonnet-5-5" })
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(sent()).toBe(1);
    const s = ledger.summary(false);
    expect(s.stages["research"]?.input_tokens).toBe(1_000_000);
    expect(s.total.cost_usd).toBeCloseTo(2, 6);
  });

  test("a call that fails after answered rounds still records them", async () => {
    const { p } = provider([{ status: 200, body: PAUSED }, { status: 400, body: { error: "bad" } }]);
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    const metered = meter(p, ledger, "research");
    await expect(metered.completeWithTools?.("q", SEARCH, { model: "claude-sonnet-5-5" })).rejects.toThrow();
    expect(ledger.summary(false).stages["research"]?.input_tokens).toBe(1_000_000);
  });

  test("under the cap, the call completes and is recorded once, in full", async () => {
    const { p, sent } = provider([{ status: 200, body: PAUSED }, { status: 200, body: DONE }]);
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    const out = await meter(p, ledger, "research").completeWithTools?.("q", SEARCH, { model: "claude-sonnet-5-5" });
    expect(out?.rounds).toBe(2);
    expect(sent()).toBe(2);
    const stage = ledger.summary(false).stages["research"];
    expect(stage?.calls).toBe(1);
    expect(stage?.input_tokens).toBe(1_000_010);
  });
});
