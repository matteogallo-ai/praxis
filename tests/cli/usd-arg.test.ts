/**
 * `--max-cost-usd` takes a plain decimal number of dollars and nothing else,
 * in the `praxis` CLI and in `run-all.ts` alike: `Number()` alone accepts
 * hex, exponents, binary and surrounding whitespace.
 */
import { describe, expect, test } from "bun:test";

import { parseRunAllArgs } from "../../benchmarks/run-all.ts";
import { extractRunArgs } from "../../src/cli/run-args.ts";

const refused = ["0x10", "1e3", "1E3", "0b11", "0o7", " 8", "8 ", "+8", "8.", ".5", "8,5", "Infinity", "0", "0.00", "-1", "1_000"];
const accepted: Array<[string, number]> = [["8", 8], ["0.5", 0.5], ["12.25", 12.25], ["008", 8]];

describe("--max-cost-usd", () => {
  test("praxis brief refuses every non-decimal or non-positive form", () => {
    for (const v of refused) {
      expect(extractRunArgs(["--max-cost-usd", v])).toMatchObject({ error: expect.stringMatching(/--max-cost-usd/) });
    }
    for (const [v, n] of accepted) {
      expect(extractRunArgs(["--max-cost-usd", v])).toMatchObject({ run: { maxCostUsd: n } });
    }
  });

  test("run-all refuses the same forms", () => {
    for (const v of refused) expect(() => parseRunAllArgs(["--max-cost-usd", v])).toThrow(/--max-cost-usd/);
    for (const [v, n] of accepted) expect(parseRunAllArgs(["--max-cost-usd", v]).maxCostUsd).toBe(n);
  });
});
