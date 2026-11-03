/**
 * Per-stage ceilings that a live run has measured are held to that
 * measurement.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { stageLimits } from "../../src/agents/stage-limits.ts";

/** Step 0's first live run: the risk answer was cut at its ceiling. */
const STEP0 = "benchmarks/outputs/live/05-supply-chain-acquisition/error-2026-11-03T14-47-43-035Z.json";

describe("stage limits", () => {
  const record = JSON.parse(readFileSync(STEP0, "utf-8")) as { error: string; error_type: string };
  const cut = Number(record.error.match(/Agent 'risk' failed: .*cut at max_tokens \((\d+)\)/)?.[1]);

  test("the run record names risk and the ceiling its answer was cut at", () => {
    expect(record.error_type).toBe("TruncatedOutputError");
    expect(cut).toBe(16_000);
  });

  test("risk's ceiling is twice the one its live answer was cut at", () => {
    // A cut answer gives only a lower bound on what it needed; doubling it is
    // the margin until a completed run measures the real size.
    expect(stageLimits("risk").maxTokens).toBeGreaterThanOrEqual(2 * cut);
  });

  test("risk's timeout still covers its ceiling at the slow decode rate", () => {
    const { maxTokens, maxSearches, timeoutMs } = stageLimits("risk");
    expect(timeoutMs).toBeGreaterThanOrEqual((maxTokens / 40 + maxSearches * 10) * 1000);
  });
});
