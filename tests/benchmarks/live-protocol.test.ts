/**
 * `docs/live-proof-protocol.md` stays true to the code: the questions its
 * commands run are the ones its selection rule picks, and its cost table is
 * what `estimate:cost` prints for them.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  capWalk,
  estimateBriefing,
  estimateRun,
  type MockMetadata,
  type Scenario,
  SCENARIOS,
} from "../../benchmarks/estimate-cost.ts";
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
const flat = doc.replace(/\s+/g, " ");
const mock = (id: string) =>
  JSON.parse(readFileSync(`benchmarks/outputs/mock/${id}/metadata.json`, "utf-8")) as MockMetadata;
const scenario = (name: Scenario["name"]) => SCENARIOS.find((x) => x.name === name) as Scenario;
const STRICT = new Set(["11-family-office-co-investment"]);
/** The smallest cap, to the cent, under which `done` holds for the probe. */
function smallestCap(sc: Scenario, done: (refusedAt: string | null) => boolean): number {
  for (let cents = 100; cents < 3000; cents++) {
    if (done(capWalk(mock(PROBE), false, sc, cents / 100).refusedAt)) return cents / 100;
  }
  return Number.NaN;
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

  test("under later caps, every question's high case completes through the reservations", () => {
    for (const c of commands.slice(1)) {
      for (const id of c.ids) {
        expect(capWalk(mock(id), STRICT.has(id), scenario("high"), c.cap).refusedAt).toBeNull();
      }
    }
  });

  test("step 0's estimate and ceiling are what estimate:cost computes", () => {
    const step0 = commands[0] as { cap: number; ids: string[] };
    const [row] = estimateRun(".", step0.ids).rows;
    expect(doc).toContain(`| Estimate | ${usd(row?.low ?? 0)} | ${usd(row?.central ?? 0)} | ${usd(row?.high ?? 0)} |`);
    expect(doc).toContain(`Ceiling: **${usd(step0.cap)}**`);
    const names = { low: "Low", central: "Central", high: "High" } as const;
    for (const sc of SCENARIOS) {
      const w = capWalk(mock(PROBE), false, sc, step0.cap);
      const outcome = w.refusedAt === null ? "completes" : `stops before ${w.refusedAt}`;
      expect(doc).toContain(`| ${names[sc.name]} | ${outcome} at ${usd(w.spent)} |`);
    }
  });

  test("step 0's high-case reservation and the caps that would let it finish are the walk's", () => {
    const high = scenario("high");
    const w = capWalk(mock(PROBE), false, high, commands[0]?.cap ?? Number.NaN);
    expect(flat).toContain(`reserves ${usd(w.reservations["adversarial"] ?? 0)} on top of ${usd(w.spent)} spent`);
    const once = { ...high, stageRetries: 0 };
    const brief = (r: string | null) => r === null || r === "synthesis-rerun";
    const full = (r: string | null) => r === null;
    expect(flat).toContain(`from a cap of ${usd(smallestCap(once, brief))} (rerun skipped)`);
    expect(flat).toContain(`finish in full from ${usd(smallestCap(once, full))}`);
    expect(flat).toContain(`with one stage retry, ${usd(smallestCap(high, brief))} and ${usd(smallestCap(high, full))}`);
  });

  test("its cost table is what estimate:cost prints for those questions", () => {
    const { rows, totals } = estimateRun(".", selected());
    for (const r of rows) {
      expect(doc).toContain(`| ${r.id} | ${usd(r.low)} | ${usd(r.central)} | ${usd(r.high)} |`);
    }
    expect(doc).toContain(`| **Total** | **${usd(totals.low)}** | **${usd(totals.central)}** | **${usd(totals.high)}** |`);
  });

  test("its ceilings are the caps times the briefings", () => {
    const later = commands[commands.length - 1] as { cap: number; ids: string[] };
    expect(flat).toContain(`For all five at ${usd(later.cap).replace(".00", "")} the ceiling is ${usd(5 * later.cap)}`);
    expect(flat).toContain(`${usd(later.ids.length * later.cap)} for the four`);
  });

  test("its judge variants follow the price table: 16 000 in, 8 000 out, 15 calls per briefing", async () => {
    const { DEFAULT_PRICE_TABLE } = await import("../../src/llm/pricing.ts");
    const p = (m: string) => DEFAULT_PRICE_TABLE.models[m] as { input: number; output: number; cache_write: number; cache_read: number };
    const perCall = (m: string) => (16_000 * p(m).input + 8_000 * p(m).output) / 1e6;
    const row = (label: string, call: string, briefing: number) =>
      `| ${label} | ${call} | ${usd(briefing)} | ${usd(5 * briefing)} | ${usd(10 * briefing)} |`;
    for (const [label, m] of [["Fable 5.1, $10 / $50", "claude-fable-5-1"], ["Opus 5, $5 / $25", "claude-opus-5"]] as const) {
      expect(doc).toContain(row(label, usd(perCall(m)), 15 * perCall(m)));
    }
    // Per copy: one cache write and two reads of the input; every call's output.
    const o5 = p("claude-opus-5");
    const cachedInput = (16_000 * (o5.cache_write + 2 * o5.cache_read)) / 1e6;
    const cached = 5 * cachedInput + (15 * 8_000 * o5.output) / 1e6;
    expect(doc).toContain(row("Opus 5, input cached", "—", cached));
    expect(flat).toContain(`falls from ${usd((3 * 16_000 * o5.input) / 1e6)} to $${cachedInput.toFixed(3)}`);
    expect(doc).toContain(row("Opus 5, Batch API", usd(perCall("claude-opus-5") / 2), (15 * perCall("claude-opus-5")) / 2));
    expect(flat).toContain(`Rejected: Opus 5.5 (${usd(perCall("claude-opus-5-5"))} per call)`);
  });

  test("its step 0 comparisons are the estimator's", () => {
    const [q05] = estimateRun(".", [PROBE]).rows;
    const [q11] = estimateRun(".", ["11-family-office-co-investment"]).rows;
    const [q12] = estimateRun(".", ["12-sodium-ion-plant-morocco"]).rows;
    expect(doc.replace(/\s+/g, " ")).toContain(`Question 11 is ${usd((q05?.central ?? 0) - (q11?.central ?? 0))} cheaper`);
    for (const k of ["low", "central", "high"] as const) expect(usd(q12?.[k] ?? 0)).toBe(usd(q05?.[k] ?? 0));
  });
});
