/**
 * docs/SLO.md holds targets set from intended use. A target the estimate
 * already misses is published as not met, with the estimate that misses it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { estimateRun } from "../../benchmarks/estimate-cost.ts";
import { stageLimits } from "../../src/agents/stage-limits.ts";
import { DEFAULT_PRICE_TABLE } from "../../src/llm/pricing.ts";

const doc = readFileSync("docs/SLO.md", "utf-8");
const flat = doc.replace(/\s+/g, " ");
const usd = (n: number) => `$${n.toFixed(2)}`;
/**
 * The cost target is set from intended use. It is written here as well as in
 * the doc so that raising it to fit the estimate takes a visible test change.
 */
const COST_TARGET_USD = 2.5;
const FIVE = [
  "02-cfo-buyback-briefing",
  "05-supply-chain-acquisition",
  "08-ai-regulation-position",
  "11-family-office-co-investment",
  "12-sodium-ion-plant-morocco",
];

describe("docs/SLO.md", () => {
  const [q05] = estimateRun(".", ["05-supply-chain-acquisition"]).rows;
  const five = estimateRun(".", FIVE).rows;

  test("publishes the cost target's status against step 0's estimate", () => {
    const status = (q05?.central ?? 0) > COST_TARGET_USD ? "**Not met**" : "Not measured";
    expect(doc).toContain(
      `| Cost | p95 ≤ ${usd(COST_TARGET_USD)} per briefing | ${status}, on the estimate: question 05 (step 0), ${usd(q05?.low ?? 0)} low, ${usd(q05?.central ?? 0)} central, ${usd(q05?.high ?? 0)} high |`
    );
  });

  test("grounds the cost target in the analyst time a briefing replaces", () => {
    expect(flat).toContain("must cost less than 10 minutes of the time of the analyst it replaces");
    expect(flat).toContain(`${usd(COST_TARGET_USD)} for 10 minutes is ${usd(COST_TARGET_USD * 6)} an hour`);
  });

  test("states the central range of the five protocol questions", () => {
    const c = five.map((r) => r.central);
    expect(flat).toContain(`the five protocol questions range from ${usd(Math.min(...c))} to ${usd(Math.max(...c))} central`);
  });

  test("its per-run caps are the protocol's, and none is below a central estimate", () => {
    const protocol = readFileSync("docs/live-proof-protocol.md", "utf-8");
    const caps = [...protocol.matchAll(/bun run bench:live -- --max-cost-usd (\d+)/g)].map((m) => Number(m[1]));
    expect(caps.length).toBe(2);
    expect(flat).toContain(`$${caps[0]} for the first live briefing, $${caps[1]} for each of the next four`);
    for (const cap of caps) expect(cap).toBeGreaterThanOrEqual(Math.max(...five.map((r) => r.central)));
  });

  describe("its ceilings are computed from the stage limits", () => {
    const model = (stage: string) =>
      readFileSync(`prompts/${stage}.prompt`, "utf-8").match(/^@model\s+(\S+)/m)?.[1] as string;
    const outputUsd = (stage: string) =>
      (stageLimits(stage).maxTokens * (DEFAULT_PRICE_TABLE.models[model(stage)]?.output ?? Number.NaN)) / 1e6;
    const minutes = (stage: string) => stageLimits(stage).timeoutMs / 60_000;
    const search = ["research", "stakeholder", "risk", "options"];
    const SECTIONS = 6;

    test("output", () => {
      const once = outputUsd("scoping") + search.reduce((a, s) => a + outputUsd(s), 0) + SECTIONS * outputUsd("synthesis");
      const five = outputUsd("scoping") + 5 * search.reduce((a, s) => a + outputUsd(s), 0) + SECTIONS * outputUsd("synthesis");
      expect(flat).toContain(`one round per stage costs at most ${usd(once)}`);
      expect(flat).toContain(`the ceiling is ${usd(five)}`);
    });

    test("latency", () => {
      const once = minutes("scoping") + search.reduce((a, s) => a + minutes(s), 0) + minutes("synthesis");
      const five = minutes("scoping") + 5 * search.reduce((a, s) => a + minutes(s), 0) + minutes("synthesis");
      expect(flat).toContain(`the request timeouts add up to ${once} minutes with one round per stage, ${five} minutes with five`);
    });
  });
});
