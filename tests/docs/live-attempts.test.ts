/**
 * README and the system card state how many live attempts failed. Five
 * failed in 1.2.1 before run records existed; the rest are counted from the
 * committed records, so a new live run cannot leave the count stale.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { liveRecords } from "./live-records.ts";

const UNRECORDED_FAILURES = 5;

describe("live attempt count", () => {
  const { failures, completed } = liveRecords();
  const failed = UNRECORDED_FAILURES + failures.length;
  const attempts = failed + completed;

  for (const path of ["README.md", "docs/SYSTEM_CARD.md"]) {
    test(`${path} states it from the run records`, () => {
      // The sentence below holds only while nothing has completed; a
      // completed run must rewrite it, not just bump the numbers.
      expect(completed).toBe(0);
      const flat = readFileSync(path, "utf-8").replace(/\s+/g, " ");
      expect(flat).toContain(
        `${failed} of ${attempts} live attempts failed so far (${UNRECORDED_FAILURES} in 1.2.1 without committed records, ${failures.length} on 3 Nov)`
      );
      expect(flat).not.toContain("5 of 5,");
    });
  }
});
