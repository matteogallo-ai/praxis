/**
 * README and the system card state how many live attempts were made and how
 * they ended. Five failed in 1.2.1 before run records existed; the rest are
 * counted from the committed records, so a new live run cannot leave the
 * count stale.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { countWord, days, liveRecords, questionsOf, sourcingFlag, UNRECORDED_FAILURES, wilson } from "./live-records.ts";

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

  describe("the completed briefings, wherever they are described", () => {
    const usd = (n: number) => `$${n.toFixed(2)}`;
    const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
    const [step0] = completions;
    const count = countWord(completions.length);

    test("README: each one's cost and sourcing flag", () => {
      expect(flat("README.md")).toContain(`Praxis has completed **${count} briefings against a real model**`);
      for (const c of completions) expect(flat("README.md")).toContain(`${usd(c.cost_usd)}, ${sourcingFlag(c)}`);
    });

    test("system card: each one's flag, and the cost and latency row", () => {
      const card = flat("docs/SYSTEM_CARD.md");
      expect(card).toContain(`**Status: ${count} briefings have completed against a real model**`);
      for (const c of completions) expect(card).toContain(sourcingFlag(c));
      const each = completions.map((c) => `${usd(c.cost_usd)}, ${minutes(c.stages_ms)} of stages`).join("; ");
      expect(card).toContain(`| Live cost and latency per briefing | ${completions.length} | ${each};`);
    });

    test("protocol: what step 0's completed attempt measured", () => {
      const a = step0?.adversarial;
      const p = flat("docs/live-proof-protocol.md");
      expect(p).toContain(
        `${usd(step0?.cost_usd ?? 0)} under the $10 cap, ${Math.round((step0?.stages_ms ?? 0) / 1000)} s of stages, ${step0?.searches} web searches`
      );
      expect(p).toContain(`${a?.critical_count} critical, ${a?.material_count} material and ${a?.minor_count} minor`);
      expect(p).toContain(sourcingFlag(step0 as NonNullable<typeof step0>));
    });

    test("CLAUDE.md and the SLO name them", () => {
      expect(flat("CLAUDE.md")).toContain(
        `${count} briefings have completed against a real model (${questionsOf(completions)}, ${days(completions)}`
      );
      const capital = count.charAt(0).toUpperCase() + count.slice(1);
      expect(flat("docs/SLO.md")).toContain(`**${capital} live briefings have completed** (${questionsOf(completions)}, ${days(completions)}`);
    });
  });
});
