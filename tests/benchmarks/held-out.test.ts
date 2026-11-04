/**
 * Question 05 is in the test split, but the sourcing fixes (#31, #32, #34, #35, #37 to #39)
 * were designed from its step 0 failures. Its later results are no longer
 * held-out evidence, and every place that reports on the split or on its
 * runs must say so.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { loadSplit } from "../../benchmarks/split.ts";

const NOTE = "q05 used for development after step 0; no longer held-out";
const read = (path: string) => readFileSync(path, "utf-8");

describe("held-out questions", () => {
  test("question 05 is still in the test split, which is why the note is needed", () => {
    // If a redraw moves it to dev, the note is to be revisited, not kept blindly.
    expect(loadSplit(".").test).toContain("05-supply-chain-acquisition");
  });

  for (const path of [
    "benchmarks/README.md",
    "benchmarks/RESULTS.md",
    "benchmarks/outputs/live/README.md",
    "docs/SYSTEM_CARD.md",
    "docs/live-proof-protocol.md",
  ]) {
    test(`${path} says question 05 is no longer held-out`, () => {
      expect(read(path)).toContain(NOTE);
    });
  }

  test("the step 0 / rerun comparison table carries it as a row", () => {
    expect(read("benchmarks/outputs/live/README.md")).toContain(`| Held-out (test split) | yes | no: ${NOTE} |`);
  });
});
