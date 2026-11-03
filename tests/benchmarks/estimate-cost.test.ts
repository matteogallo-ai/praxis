/**
 * The pre-run cost estimate (`benchmarks/estimate-cost.ts`).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ceiling, estimateBriefing, estimateRun, type MockMetadata, type Scenario, SCENARIOS } from "../../benchmarks/estimate-cost.ts";
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

describe("ceiling", () => {
  const ids = ["02-cfo-buyback-briefing", "11-family-office-co-investment"];

  test("metered: each briefing at the cap plus its costliest request", () => {
    const c = ceiling(".", ids, 14);
    expect(c.maxRequest).toBeGreaterThan(0);
    expect(c.metered).toBeCloseTo(2 * (14 + c.maxRequest), 10);
  });

  test("unmetered: every request of a question timing out on both attempts", () => {
    const c = ceiling(".", ids, 14);
    const id = "11-family-office-co-investment"; // strict_editorial: synthesis counted twice
    const meta = JSON.parse(readFileSync(`benchmarks/outputs/mock/${id}/metadata.json`, "utf-8")) as MockMetadata;
    const once = estimateBriefing(meta, true, { ...scenario("high"), stageRetries: 0 }).total;
    expect(c.unmetered[id]).toBeCloseTo(2 * once, 10);
    expect(c.worst).toBeCloseTo(c.metered + Object.values(c.unmetered).reduce((a, b) => a + b, 0), 10);
  });
});
