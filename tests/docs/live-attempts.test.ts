/**
 * README and the system card state how many live attempts were made and how
 * they ended. Five failed in 1.2.1 before run records existed; the rest are
 * counted from the committed records, so a new live run cannot leave the
 * count stale.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { attemptsSentence, byCommit, countWord, days, liveRecords, questionsOf, sourcingFlag, UNRECORDED_FAILURES } from "./live-records.ts";

const flat = (path: string) => readFileSync(path, "utf-8").replace(/\s+/g, " ");

describe("live attempt count", () => {
  const { failures, completions } = liveRecords();
  const sentence = attemptsSentence();

  test("failures and completions are listed oldest first, whatever the directory order", () => {
    const sorted = (xs: readonly { at: string }[]) => xs.every((x, i) => i === 0 || (xs[i - 1] as { at: string }).at <= x.at);
    expect(sorted(failures)).toBe(true);
    expect(sorted(completions)).toBe(true);
  });

  test("every recorded attempt is counted under exactly one commit", () => {
    const groups = byCommit();
    expect(groups.reduce((n, g) => n + g.attempts, 0)).toBe(failures.length + completions.length);
    expect(new Set(groups.map((g) => g.sha)).size).toBe(groups.length);
  });

  for (const path of ["README.md", "docs/SYSTEM_CARD.md"]) {
    test(`${path} states the attempts by commit, from the run records`, () => {
      expect(flat(path)).toContain(sentence);
      expect(flat(path)).not.toContain("6 of 6");
      // A rate pooled over several versions of the code, and attempts
      // without a record, describe no version: neither is published.
      expect(flat(path)).not.toMatch(/\d+ of \d+ \| [^|]*\(Wilson\)/);
      expect(flat(path)).not.toMatch(/\b\d+ live attempts: /);
    });
  }

  test("the system card has one completion row per commit, without an interval", () => {
    const card = flat("docs/SYSTEM_CARD.md");
    for (const g of byCommit()) {
      expect(card).toContain(`| Live briefings completed at \`${g.sha}\` | ${g.attempts} | ${g.completed} of ${g.attempts} | — |`);
    }
    expect(card).toContain(`| Live attempts in 1.2.1, no record committed | ${UNRECORDED_FAILURES} | failed, as stated in CHANGELOG 1.2.1 | — |`);
  });

  describe("the completed briefings, wherever they are described", () => {
    const usd = (n: number) => `$${n.toFixed(2)}`;
    const minutes = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
    const [step0] = completions;
    const count = countWord(completions.length);

    test("README: each one's cost and sourcing flag", () => {
      expect(flat("README.md")).toContain(`Praxis has completed **${count} briefings against a real model**`);
      const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&");
      for (const c of completions) {
        expect(flat("README.md")).toMatch(new RegExp(`question ${c.id.slice(0, 2)}[^:;]*: ${esc(`${usd(c.cost_usd)}, ${sourcingFlag(c)}`)}`));
      }
    });

    test("system card: each one's flag, and the cost and latency row", () => {
      const card = flat("docs/SYSTEM_CARD.md");
      expect(card).toContain(`**Status: ${count} briefings have completed against a real model**`);
      const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\$]/g, "\\$&");
      for (const c of completions) expect(card).toMatch(new RegExp(`question ${c.id.slice(0, 2)}[^;]*?, ${esc(sourcingFlag(c))}`));
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
