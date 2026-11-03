/**
 * docs/SLO.md holds targets set from intended use. A target the estimate
 * already misses is published as not met, with the estimate that misses it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { estimateRun } from "../../benchmarks/estimate-cost.ts";

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
});
