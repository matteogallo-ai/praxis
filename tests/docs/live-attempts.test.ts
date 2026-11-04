/**
 * README and the system card state how many live attempts were made and how
 * they ended. Five failed in 1.2.1 before run records existed; the rest are
 * counted from the committed records, so a new live run cannot leave the
 * count stale.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { days, liveRecords, UNRECORDED_FAILURES, wilson } from "./live-records.ts";

const flat = (path: string) => readFileSync(path, "utf-8").replace(/\s+/g, " ");

describe("live attempt count", () => {
  const { failures, completions } = liveRecords();
  const failed = UNRECORDED_FAILURES + failures.length;
  const attempts = failed + completions.length;
  const sentence = `${attempts} live attempts: ${failed} failed (${UNRECORDED_FAILURES} in 1.2.1 without committed records, ${failures.length} on ${days(failures)}), ${completions.length} completed (${days(completions)})`;

  for (const path of ["README.md", "docs/SYSTEM_CARD.md"]) {
    test(`${path} states it from the run records`, () => {
      expect(flat(path)).toContain(sentence);
      expect(flat(path)).not.toContain("6 of 6");
    });
  }

  test("the system card's completion row and its Wilson interval", () => {
    expect(wilson(0, 5)).toBe("0%–43%");
    expect(flat("docs/SYSTEM_CARD.md")).toContain(
      `| Live briefings completed | ${attempts} attempts | ${completions.length} of ${attempts} | ${wilson(completions.length, attempts)} (Wilson) |`
    );
  });
});
