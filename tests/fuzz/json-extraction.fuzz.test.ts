/**
 * A short, reproducible run of the JSON-extraction fuzzer on every test run;
 * `bun run fuzz` runs it for longer with a fresh seed.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { checkExtraction, fuzzInput, SEEDS } from "./json-extraction.fuzz.ts";

describe("extractJsonText — fuzzing", () => {
  test("every seed passes the oracles", () => {
    for (const seed of SEEDS) expect(() => checkExtraction(seed)).not.toThrow();
  });

  test("the oracles catch a broken extractor", () => {
    const answer = 'Here it is: {"a": 1}';
    expect(() => checkExtraction(answer, (s) => s.trim())).toThrow(/only object/);
    expect(() => checkExtraction(answer, () => '{"b": 2}')).toThrow(/neither/);
    expect(() => checkExtraction(answer, () => {
      throw new SyntaxError("boom");
    })).toThrow(SyntaxError);
    const slow = (s: string) => {
      const until = performance.now() + 400;
      while (performance.now() < until) {
        // Stands in for a scan that is too slow for its input.
      }
      return s.trim();
    };
    expect(() => checkExtraction("no object here", slow)).toThrow(/took/);
  });

  test("2 000 mutated answers pass the oracles", () => {
    fc.assert(fc.property(fuzzInput, (raw) => checkExtraction(raw)), { numRuns: 2000, seed: 20261103 });
  });
});
