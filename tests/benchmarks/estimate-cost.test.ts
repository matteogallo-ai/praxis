/**
 * The pre-run cost estimate (`benchmarks/estimate-cost.ts`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { capWalk, estimateBriefing, estimateRun, type MockMetadata, type Scenario, SCENARIOS } from "../../benchmarks/estimate-cost.ts";
import { DEFAULT_PRICE_TABLE } from "../../src/llm/pricing.ts";

const scenario = (name: string) => SCENARIOS.find((s) => s.name === name) as Scenario;

/** One web-searching Sonnet stage, prompt 1000 tokens, and one rerun stage. */
const meta: MockMetadata = {
  id: "t",
  rerun: { performed: false },
  usage: {
    stages: {
      research: { calls: 1, input_tokens: 1000, models: ["claude-sonnet-5-5"] },
      "synthesis-rerun": { calls: 6, input_tokens: 6000, models: ["claude-sonnet-5-5"] },
    },
  },
};

describe("estimateBriefing", () => {
  test("prices a web-searching call as its context re-read after each search", () => {
    const low = scenario("low"); // 2 searches of 3 000 tokens, 25% of 16 000 output, growth 1
    const output = 16_000 * 0.25; // 4 000
    // The output, spread over the 3 rounds, is re-read by the later ones: output·s/2.
    const input = 3 * 1000 + (3000 * 2 * 3) / 2 + (output * 2) / 2; // 16 000
    const expected = (input * 2 + output * 10) / 1e6 + (2 * 10) / 1000;
    expect(estimateBriefing(meta, false, low).stages["research"]).toBeCloseTo(expected, 10);
  });

  test("counts the synthesis rerun only when the scenario does, with synthesis's limits", () => {
    expect(estimateBriefing(meta, false, scenario("central")).stages).not.toHaveProperty("synthesis-rerun");
    const high = estimateBriefing(meta, false, scenario("high")).stages["synthesis-rerun"] ?? 0;
    const perCall = (1000 * 3 * 2 + 8_000 * 10) / 1e6; // no searches, synthesis's 8 000 ceiling
    expect(high).toBeCloseTo(perCall * 6, 10);
  });

  test("the high scenario counts a rerun even when the mock run had none", () => {
    const noRerun: MockMetadata = {
      id: "t",
      rerun: { performed: false },
      usage: { stages: { synthesis: { calls: 6, input_tokens: 6000, models: ["claude-sonnet-5-5"] } } },
    };
    const stages = estimateBriefing(noRerun, true, scenario("high")).stages;
    expect(stages["synthesis-rerun"]).toBeCloseTo(stages["synthesis"] ?? 0, 10);
    expect(estimateBriefing(noRerun, true, scenario("central")).stages).not.toHaveProperty("synthesis-rerun");
  });

  test("scales with the price table", () => {
    const doubled = {
      ...DEFAULT_PRICE_TABLE,
      models: { "claude-sonnet-5-5": { input: 4, output: 20, cache_write: 5, cache_read: 0.4 } },
      web_search_per_1000: 20,
    };
    const base = estimateBriefing(meta, false, scenario("high")).total;
    expect(estimateBriefing(meta, false, scenario("high"), doubled).total).toBeCloseTo(base * 2, 10);
  });

  test("refuses a model with no price rather than costing it at zero", () => {
    const unpriced = { ...meta, usage: { stages: { scoping: { calls: 1, input_tokens: 10, models: ["x"] } } } };
    expect(() => estimateBriefing(unpriced, false, scenario("low"))).toThrow(/no price/);
  });
});

describe("estimateRun", () => {
  test("orders low ≤ central ≤ high for every shipped mock briefing", () => {
    const ids = ["02-cfo-buyback-briefing", "11-family-office-co-investment", "12-sodium-ion-plant-morocco"];
    const { rows, totals } = estimateRun(".", ids);
    for (const r of rows) {
      expect(r.low).toBeGreaterThan(0);
      expect(r.low).toBeLessThanOrEqual(r.central);
      expect(r.central).toBeLessThanOrEqual(r.high);
    }
    expect(totals.central).toBeCloseTo(rows.reduce((a, r) => a + r.central, 0), 10);
  });
});

describe("capWalk", () => {
  // Research: Sonnet, prompt 1000 mock tokens = 4000 characters, 1334 tokens at
  // the 3-character floor; 16 000 max_tokens, 5 searches of 15 000 tokens:
  //   input = 6 × 1334 + 15 000 × 15 + 16 000 × 5 = 313 004 → $0.626008
  //   (all output before the first search, re-read by the 5 later rounds)
  //   output $0.16, searches $0.05 → $0.836008 reserved, growth ×1 (low).
  const research: MockMetadata = {
    ...meta,
    usage: { stages: { research: { calls: 1, input_tokens: 1000, models: ["claude-sonnet-5-5"] } } },
  };
  const low = scenario("low");

  test("a request reserves its whole max_tokens, every search and 15 000 tokens per search", () => {
    expect(capWalk(research, false, low, 100).reservations["research"]).toBeCloseTo(0.836008, 6);
  });

  test("a cap below the first request's worst case refuses it with nothing spent", () => {
    expect(capWalk(research, false, low, 0.836)).toEqual(
      expect.objectContaining({ spent: 0, refusedAt: "research" })
    );
    expect(capWalk(research, false, low, 0.836008).refusedAt).toBeNull();
  });

  test("synthesis sections start together, so all of them must fit at once", () => {
    const synth = { ...meta, usage: { stages: { synthesis: { calls: 6, input_tokens: 6000, models: ["claude-sonnet-5-5"] } } } };
    const one = capWalk(synth, false, low, 100).reservations["synthesis"] ?? 0;
    expect(capWalk(synth, false, low, 6 * one - 0.001).refusedAt).toBe("synthesis");
    expect(capWalk(synth, false, low, 6 * one).refusedAt).toBeNull();
  });

  test("a briefing that completes spends the scenario's estimate, its retry included", () => {
    for (const id of ["05-supply-chain-acquisition", "11-family-office-co-investment"]) {
      const m = JSON.parse(readFileSync(`benchmarks/outputs/mock/${id}/metadata.json`, "utf-8")) as MockMetadata;
      const strict = id.startsWith("11");
      for (const sc of SCENARIOS) {
        const w = capWalk(m, strict, sc, 1000);
        expect(w.refusedAt).toBeNull();
        expect(w.spent).toBeCloseTo(estimateBriefing(m, strict, sc).total, 10);
      }
    }
  });
});
