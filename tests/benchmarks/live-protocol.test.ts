/**
 * `docs/live-proof-protocol.md` stays true to the code: the questions its
 * commands run are the ones its selection rule picks, and its cost table is
 * what `estimate:cost` prints for them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { estimateRun } from "../../benchmarks/estimate-cost.ts";
import { loadManifest } from "../../benchmarks/manifest.ts";
import { loadSplit, MANIFEST_PATH } from "../../benchmarks/split.ts";

const doc = readFileSync("docs/live-proof-protocol.md", "utf-8");

/** The first test question of each format in id order, then the hard case. */
function selected(): string[] {
  const testIds = new Set(loadSplit(".").test);
  const entries = loadManifest(MANIFEST_PATH)
    .benchmarks.filter((b) => testIds.has(b.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  const firstPerFormat = new Map<string, string>();
  for (const b of entries) {
    if (!b.tags.includes("hard") && !firstPerFormat.has(b.format)) firstPerFormat.set(b.format, b.id);
  }
  const hard = entries.filter((b) => b.tags.includes("hard")).map((b) => b.id);
  return [...firstPerFormat.values(), ...hard].sort();
}

describe("docs/live-proof-protocol.md", () => {
  test("its bench:live commands run exactly the questions the rule selects", () => {
    const ids = [...doc.matchAll(/bun run bench:live -- [^\n]*--ids (\S+)/g)].flatMap((m) => (m[1] ?? "").split(","));
    expect(ids.sort()).toEqual(selected());
  });

  test("every bench:live command carries a cost cap", () => {
    const commands = [...doc.matchAll(/bun run bench:live[^\n]*/g)].map((m) => m[0]);
    expect(commands.length).toBeGreaterThan(0);
    for (const c of commands) expect(c).toMatch(/--max-cost-usd \d+/);
  });

  test("the cap sits above every question's high estimate, so a costly healthy briefing completes", () => {
    const caps = [...doc.matchAll(/bun run bench:live[^\n]*--max-cost-usd (\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    const highest = Math.max(...estimateRun(".", selected()).rows.map((r) => r.high));
    for (const cap of caps) expect(cap).toBeGreaterThan(highest);
  });

  test("its cost table is what estimate:cost prints for those questions", () => {
    const { rows, totals } = estimateRun(".", selected());
    const usd = (n: number) => `$${n.toFixed(2)}`;
    for (const r of rows) {
      expect(doc).toContain(`| ${r.id} | ${usd(r.low)} | ${usd(r.central)} | ${usd(r.high)} |`);
    }
    expect(doc).toContain(`| **Total** | **${usd(totals.low)}** | **${usd(totals.central)}** | **${usd(totals.high)}** |`);
  });
});
