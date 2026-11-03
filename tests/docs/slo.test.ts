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

describe("docs/SLO.md", () => {
  const target = Number(doc.match(/\| Cost \| p95 ≤ \$(\d+(?:\.\d+)?) per briefing \|/)?.[1]);
  const [q05] = estimateRun(".", ["05-supply-chain-acquisition"]).rows;

  test("states a cost target", () => {
    expect(target).toBeGreaterThan(0);
  });

  test("publishes the cost target's status against the estimate", () => {
    const central = q05?.central ?? 0;
    const status = central > target ? "**Not met**" : "Not measured";
    expect(doc).toContain(
      `| Cost | p95 ≤ ${usd(target)} per briefing | ${status}, on the estimate: question 05, ${usd(central)} central, ${usd(q05?.high ?? 0)} high |`
    );
  });

  test("suggests no cap below the central estimate", () => {
    for (const m of flat.matchAll(/--max-cost-usd (\d+(?:\.\d+)?)/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(q05?.central ?? 0);
    }
  });
});
