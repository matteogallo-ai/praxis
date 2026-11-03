/**
 * `docs/live-proof-protocol.md` stays true to the code: the questions its
 * commands run are the ones its selection rule picks, and its cost table is
 * what `estimate:cost` prints for them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ceiling, estimateBriefing, estimateRun, type MockMetadata, type Scenario, SCENARIOS } from "../../benchmarks/estimate-cost.ts";
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

/** Step 0's single briefing and its cap, as the doc's first command runs them. */
const PROBE = "05-supply-chain-acquisition";
const commands = [...doc.matchAll(/bun run bench:live -- --max-cost-usd (\d+(?:\.\d+)?) --ids (\S+)/g)].map((m) => ({
  cap: Number(m[1]),
  ids: (m[2] ?? "").split(","),
}));
const usd = (n: number) => `$${n.toFixed(2)}`;

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

  test("step 0 runs the probe alone, first, under a cap above its central estimate", () => {
    expect(commands[0]?.ids).toEqual([PROBE]);
    const [row] = estimateRun(".", [PROBE]).rows;
    expect(commands[0]?.cap).toBeGreaterThan(row?.central ?? Number.POSITIVE_INFINITY);
  });

  test("step 0's cumulative stage costs are the estimator's, high scenario", () => {
    const meta = JSON.parse(readFileSync(`benchmarks/outputs/mock/${PROBE}/metadata.json`, "utf-8")) as MockMetadata;
    const high = SCENARIOS.find((x) => x.name === "high") as Scenario;
    const { stages } = estimateBriefing(meta, false, high);
    const names: Record<string, string> = { stakeholder: "stakeholders", risk: "risks" };
    let total = 0;
    for (const stage of ["scoping", "research", "stakeholder", "risk", "options", "synthesis", "adversarial"]) {
      total += stages[stage] ?? 0;
      expect(doc.replace(/\s+/g, " ")).toContain(`${names[stage] ?? stage} ${usd(total)}`);
    }
  });

  test("later caps sit above every question's high estimate, so a costly healthy briefing completes", () => {
    for (const c of commands.slice(1)) {
      const highest = Math.max(...estimateRun(".", c.ids).rows.map((r) => r.high));
      expect(c.cap).toBeGreaterThan(highest);
    }
  });

  test("step 0's estimate and ceiling are what estimate:cost computes", () => {
    const step0 = commands[0] as { cap: number; ids: string[] };
    const [row] = estimateRun(".", step0.ids).rows;
    expect(doc).toContain(`| Estimate | ${usd(row?.low ?? 0)} | ${usd(row?.central ?? 0)} | ${usd(row?.high ?? 0)} |`);
    const c = ceiling(".", step0.ids, step0.cap);
    expect(doc).toContain(`Metered ceiling: **${usd(c.metered)}**`);
    expect(doc).toContain(`unseen by the cap:\n  **${usd(c.worst)}**`);
  });

  test("its cost table is what estimate:cost prints for those questions", () => {
    const { rows, totals } = estimateRun(".", selected());
    for (const r of rows) {
      expect(doc).toContain(`| ${r.id} | ${usd(r.low)} | ${usd(r.central)} | ${usd(r.high)} |`);
    }
    expect(doc).toContain(`| **Total** | **${usd(totals.low)}** | **${usd(totals.central)}** | **${usd(totals.high)}** |`);
  });

  test("its ceiling is what estimate:cost computes for those questions and that cap", () => {
    const cap = commands[commands.length - 1]?.cap ?? Number.NaN;
    const c = ceiling(".", selected(), cap);
    expect(doc).toContain(`costliest single request ${usd(c.maxRequest)}`);
    expect(doc).toContain(`Metered ceiling, high scenario**: ${usd(c.metered)}`);
    for (const [id, v] of Object.entries(c.unmetered)) expect(doc).toContain(`| ${id} | ${usd(v)} |`);
    expect(doc).toContain(`Worst case**: ${usd(c.worst)}`);
  });

  test("its judge figures follow the price table: 16 000 in, 8 000 out, 15 calls per briefing", async () => {
    const { JUDGE_MODEL } = await import("../../benchmarks/score-all.ts");
    const { DEFAULT_PRICE_TABLE } = await import("../../src/llm/pricing.ts");
    const judge = DEFAULT_PRICE_TABLE.models[JUDGE_MODEL] as { input: number; output: number };
    const opus = DEFAULT_PRICE_TABLE.models["claude-opus-5-5"] as { input: number; output: number };
    const perCall = (p: { input: number; output: number }) => (16_000 * p.input + 8_000 * p.output) / 1e6;
    const flat = doc.replace(/\s+/g, " ");
    expect(flat).toContain(`$${judge.input} / $${judge.output} per million tokens`);
    expect(flat).toContain(`${usd(perCall(judge))} per call`);
    expect(flat).toContain(`**${usd(perCall(judge) * 15)} per briefing**`);
    expect(flat).toContain(`${usd(perCall(judge) * 75)} for the five`);
    expect(flat).toContain(`**${usd(perCall(judge) * 150)}** with a 2× margin`);
    expect(flat).toContain(`Opus 5.5 (${usd(perCall(opus))} per call, ${usd(perCall(opus) * 75)} for the five)`);
  });

  test("its step 0 comparisons are the estimator's", () => {
    const [q05] = estimateRun(".", [PROBE]).rows;
    const [q11] = estimateRun(".", ["11-family-office-co-investment"]).rows;
    const [q12] = estimateRun(".", ["12-sodium-ion-plant-morocco"]).rows;
    expect(doc.replace(/\s+/g, " ")).toContain(`Question 11 is ${usd((q05?.central ?? 0) - (q11?.central ?? 0))} cheaper`);
    for (const k of ["low", "central", "high"] as const) expect(usd(q12?.[k] ?? 0)).toBe(usd(q05?.[k] ?? 0));
    const c = ceiling(".", [PROBE], commands[0]?.cap ?? Number.NaN);
    expect(doc.replace(/\s+/g, " ")).toContain(`costliest request (${usd(c.maxRequest)}, adversarial)`);
  });
});
