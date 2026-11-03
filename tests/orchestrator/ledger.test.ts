/**
 * Token and cost accounting per stage and per briefing, and the budget cap.
 *
 * Runs on the mock provider, whose usage is simulated from text length:
 * these tests prove the accounting is wired, not what a live run costs.
 */
import { describe, expect, test } from "bun:test";

import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { UsageLedger, meter } from "../../src/orchestrator/ledger.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { BudgetExceededError } from "../../src/llm/errors.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import type { LLMProvider } from "../../src/llm/provider.ts";

const QUESTION = "Should we enter the German market?";
const FORMAT = "executive-pre-read";
const NOW = new Date("2026-08-20T00:00:00.000Z");

function orchestrator(llm: LLMProvider = new MockLLMProvider({ fixturesDir: "tests/fixtures/mock-llm" })): Orchestrator {
  const registry = new FormatRegistry();
  registry.loadDirectory("formats");
  return new Orchestrator(registry, llm);
}

describe("UsageLedger through the orchestrator", () => {
  test("every stage is recorded, and the total is the sum of the stages", async () => {
    const ledger = new UsageLedger({ simulated: true });
    await orchestrator().brief(QUESTION, FORMAT, { now: NOW, ledger });
    const summary = ledger.summary();

    expect(Object.keys(summary.stages)).toEqual(["scoping", "research", "stakeholder", "risk", "options", "synthesis"]);
    expect(summary.simulated).toBe(true);
    let tokens = 0;
    let cost = 0;
    for (const stage of Object.values(summary.stages)) {
      expect(stage.calls).toBeGreaterThan(0);
      expect(stage.input_tokens).toBeGreaterThan(0);
      expect(stage.cost_usd).not.toBeNull();
      tokens += stage.input_tokens + stage.output_tokens;
      cost += stage.cost_usd ?? 0;
    }
    expect(summary.total.input_tokens + summary.total.output_tokens).toBe(tokens);
    expect(summary.total.cost_usd).toBeCloseTo(cost, 10);
    // Each stage is billed at the model its .prompt declares.
    expect(summary.stages["scoping"]!.models).toEqual(["claude-opus-5-5"]);
    expect(summary.stages["research"]!.models).toEqual(["claude-sonnet-5-5"]);
  });

  test("a cap below the first request's worst case stops the briefing before anything is sent", async () => {
    const ledger = new UsageLedger({ maxCostUsd: 0.000001 });
    const err = await orchestrator()
      .brief(QUESTION, FORMAT, { now: NOW, ledger })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as Error).message).toContain("before stage 'scoping'");
    expect((err as Error).message).toContain("the next request may cost up to");
    expect(ledger.summary().total.calls).toBe(0);
  });

  test("a provider without usage is recorded with zero tokens, not skipped", async () => {
    const ledger = new UsageLedger();
    const plain: LLMProvider = { name: "plain", complete: async () => "{}" };
    await meter(plain, ledger, "scoping").complete("q", { model: "claude-opus-5-5" });
    expect(ledger.summary().stages["scoping"]).toMatchObject({ calls: 1, input_tokens: 0, cost_usd: 0 });
  });
});

describe("UsageLedger and the synthesis rerun", () => {
  test("rerun calls are recorded under synthesis-rerun, apart from the first synthesis", async () => {
    const ledger = new UsageLedger({ simulated: true });
    const result = await orchestrator().briefWithCritiqueAndRerun(QUESTION, FORMAT, {
      now: NOW,
      ledger,
      onSourcingFailure: "degrade",
    });
    expect(result.rerun_performed).toBe(true);
    const stages = ledger.summary().stages;
    expect(stages["synthesis-rerun"]!.calls).toBe(stages["synthesis"]!.calls);
  });
});

describe("budget cap: review findings", () => {
  const u = (input: number): import("../../src/llm/types.ts").TokenUsage => ({
    input_tokens: input,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: 0,
  });

  test("a dated model id is priced as its alias", () => {
    const ledger = new UsageLedger();
    ledger.record("risk", "claude-opus-5-5-20261001", u(1_000_000));
    expect(ledger.summary().total.cost_usd).toBeCloseTo(4, 10);
  });

  test("with a cap, a call that cannot be priced stops the run", () => {
    const ledger = new UsageLedger({ maxCostUsd: 100 });
    ledger.record("risk", "claude-unknown-9", u(10));
    expect(() => ledger.assertWithinBudget("options")).toThrow(BudgetExceededError);
  });

  test("a resumed ledger starts from what earlier attempts spent", () => {
    const first = new UsageLedger({ maxCostUsd: 5 });
    first.record("research", "claude-opus-5-5", u(1_000_000)); // $4
    const resumed = new UsageLedger({ maxCostUsd: 5 });
    resumed.restore(first.summary());
    resumed.record("options", "claude-opus-5-5", u(500_000)); // $2
    expect(() => resumed.assertWithinBudget("synthesis")).toThrow(BudgetExceededError);
    expect(Object.keys(resumed.summary().stages)).toEqual(["research", "options"]);
    expect(resumed.summary().total.cost_usd).toBeCloseTo(6, 10);
  });
});
