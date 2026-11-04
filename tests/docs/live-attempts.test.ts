/**
 * README and the system card state how many live attempts were made and how
 * they ended. Five failed in 1.2.1 before run records existed; the rest are
 * counted from the committed records, so a new live run cannot leave the
 * count stale.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { days, liveRecords, sourcingFlag, UNRECORDED_FAILURES, wilson } from "./live-records.ts";

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

  describe("the one completed briefing, wherever it is described", () => {
    const [c] = completions;
    const usd = (n: number) => `$${n.toFixed(2)}`;
    // These sentences describe a single completion; a second must rewrite them.
    test("there is exactly one", () => expect(completions).toHaveLength(1));

    test("README: cost, day and its sourcing flag", () => {
      expect(flat("README.md")).toContain(`question 05, ${days(completions)}, ${usd(c?.cost_usd ?? 0)}`);
      expect(flat("README.md")).toContain(sourcingFlag(c as NonNullable<typeof c>));
    });

    test("system card: status flag and the cost and latency row", () => {
      expect(flat("docs/SYSTEM_CARD.md")).toContain(sourcingFlag(c as NonNullable<typeof c>));
      expect(flat("docs/SYSTEM_CARD.md")).toContain(
        `| Live cost and latency per briefing | 1 | ${usd(c?.cost_usd ?? 0)}, ${((c?.stages_ms ?? 0) / 60_000).toFixed(1)} min of stages;`
      );
    });

    test("protocol: what step 0's completed attempt measured", () => {
      const a = c?.adversarial;
      const p = flat("docs/live-proof-protocol.md");
      expect(p).toContain(
        `${usd(c?.cost_usd ?? 0)} under the $10 cap, ${Math.round((c?.stages_ms ?? 0) / 1000)} s of stages, ${c?.searches} web searches`
      );
      expect(p).toContain(`${a?.critical_count} critical, ${a?.material_count} material and ${a?.minor_count} minor`);
      expect(p).toContain(sourcingFlag(c as NonNullable<typeof c>));
    });

    test("CLAUDE.md and the SLO name it", () => {
      expect(flat("CLAUDE.md")).toContain(`one briefing has completed against a real model (question 05, ${days(completions)}`);
      expect(flat("docs/SLO.md")).toContain(`**One live briefing has completed** (question 05, ${days(completions)}`);
    });
  });
});
