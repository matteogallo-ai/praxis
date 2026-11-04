/**
 * `docs/live-proof-protocol.md` stays true to the code: the questions its
 * commands run are the ones its selection rule picks, and its cost table is
 * what `estimate:cost` prints for them.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

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
import { protocolParts } from "./protocol-plan.ts";

const { doc, plan, amendments } = protocolParts();

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
const COMMAND = /bun run bench:live -- --max-cost-usd (\d+(?:\.\d+)?) --ids (\S+)/g;
const parseCommands = (text: string) =>
  [...text.matchAll(COMMAND)].map((m) => ({ cap: Number(m[1]), ids: (m[2] ?? "").split(",") }));
const commands = parseCommands(plan);
/** A declared amendment: `| <date> | <step> | \`<id>\` added, before the run | <reason> |`. */
const declared = [...amendments.matchAll(/^\| (\d{4}-\d{2}-\d{2}) \| (\d+) \| `([^`]+)` added, before the run \| ([^|]+) \|$/gm)].map(
  (m) => ({ date: m[1] ?? "", step: Number(m[2]), id: m[3] ?? "", reason: (m[4] ?? "").trim() })
);
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


/** Every request of every committed count_tokens measurement. */
function measuredRequests(): { stage: string; chars: number; tokens: number }[] {
  return readdirSync("benchmarks/token-counts")
    .filter((f) => f.endsWith(".json"))
    .flatMap(
      (f) =>
        (JSON.parse(readFileSync(`benchmarks/token-counts/${f}`, "utf-8")) as {
          requests: { stage: string; chars: number; tokens: number }[];
        }).requests
    );
}

describe("docs/live-proof-protocol.md", () => {
  test("its bench:live commands run exactly the questions the rule selects", () => {
    const ids = [...plan.matchAll(/bun run bench:live -- [^\n]*--ids (\S+)/g)].flatMap((m) => (m[1] ?? "").split(","));
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

  test("an amended command runs its step's questions plus the ones declared for it, nothing else", () => {
    const amended = parseCommands(amendments);
    const steps = [...new Set(declared.map((d) => d.step))].sort((a, b) => a - b);
    expect(amended.length).toBe(steps.length);
    for (const [i, step] of steps.entries()) {
      // Step N's command is the plan's Nth: step 0, then step 1.
      const original = commands[step] as { cap: number; ids: string[] };
      const added = declared.filter((d) => d.step === step).map((d) => d.id);
      expect(amended[i]?.cap).toBe(original.cap);
      expect([...(amended[i]?.ids ?? [])].sort()).toEqual([...original.ids, ...added].sort());
      expect(amendments.replace(/\s+/g, " ")).toContain(
        `at most ${usd(original.cap)} each, ${usd(original.cap * (original.ids.length + added.length))} for the ${original.ids.length + added.length}`
      );
    }
    const testIds = new Set(loadSplit(".").test);
    for (const d of declared) {
      expect(testIds.has(d.id)).toBe(true);
      expect(selected()).not.toContain(d.id);
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });

  test("question 10 was added to step 1 on 4 Nov 2026, for the first-party list", () => {
    expect(declared).toEqual([
      {
        date: "2026-11-04",
        step: 1,
        id: "10-esg-position",
        reason: "the only test question covered by the first-party list (ADR 0003)",
      },
    ]);
  });

  test("every live-run command, in the plan or an amendment, is in the one form the checks read", () => {
    const runs = [...doc.matchAll(/bun run (?:bench:live|benchmarks\/run-all\.ts[^\n`]*--live)[^\n`]*/g)].map((m) => m[0].trim());
    expect(runs.length).toBe(parseCommands(doc).length);
    for (const r of runs) expect(r).toMatch(/^bun run bench:live -- --max-cost-usd \d+(?:\.\d+)? --ids [^\s,]+(?:,[^\s,]+)*$/);
  });

  test("every dated row of the amendments table is a declared amendment", () => {
    expect([...amendments.matchAll(/^\| \d{4}-\d{2}-\d{2} \|/gm)].length).toBe(declared.length);
  });

  test("an amendment that adds briefings scales the judge's estimate with them", () => {
    const m = /Expected ≈ \$(\d+\.\d{2}) for the five; `<n>` at most \$(\d+\.\d{2})/.exec(plan);
    const [expected, most] = [Number(m?.[1]), Number(m?.[2])];
    const n = new Set([...commands, ...parseCommands(amendments)].flatMap((c) => c.ids)).size;
    if (n > 5) {
      expect(amendments.replace(/\s+/g, " ")).toContain(
        `the judge: ≈ ${usd((expected * n) / 5)} for the ${n}; \`<n>\` at most ${usd((most * n) / 5)}`
      );
    }
  });

  test("the held-out test questions left are the test split less every question run", () => {
    const run = new Set([...commands, ...parseCommands(amendments)].flatMap((c) => c.ids));
    const left = loadSplit(".").test.filter((id) => !run.has(id));
    expect(amendments).toContain(`Held-out test questions left: ${left.map((id) => `\`${id}\``).join(" and ")}.`);
  });

  test("under later caps, every question's high case yields a brief through the reservations", () => {
    for (const c of [...commands.slice(1), ...parseCommands(amendments)]) {
      for (const id of c.ids) {
        const w = capWalk(mock(id), STRICT.has(id), scenario("high"), c.cap);
        // A rerun the cap refuses leaves the complete pre-rerun brief.
        expect([null, "synthesis-rerun"]).toContain(w.refusedAt);
        if (w.refusedAt === "synthesis-rerun") expect(flat).toContain(`rerun skipped, at ${usd(w.spent)}`);
      }
    }
  });

  test("its measured ratio, range and count are the committed measurements'", async () => {
    const { measuredCharsPerToken } = await import("../../benchmarks/estimate-cost.ts");
    const requests = measuredRequests();
    const ratios = requests.map((r) => r.chars / r.tokens);
    const files = readdirSync("benchmarks/token-counts").filter((f) => f.endsWith(".json")).length;
    expect(flat).toContain(`read at the ${measuredCharsPerToken(".").toFixed(2)} characters per token`);
    expect(flat).toContain(`measured on ${requests.length} rendered prompts of ${files} questions`);
    expect(flat).toContain(`${Math.min(...ratios).toFixed(2)} to ${Math.max(...ratios).toFixed(2)} per request`);
  });

  test("its API-overhead margin is what the measured counts leave under the floor", async () => {
    const { CHARS_PER_TOKEN_FLOOR } = await import("../../src/llm/pricing.ts");
    const requests = measuredRequests();
    const margin = (stages: string[]) =>
      Math.min(...requests.filter((r) => stages.includes(r.stage)).map((r) => Math.floor(r.chars / CHARS_PER_TOKEN_FLOOR - r.tokens)));
    expect(flat).toContain(`at least ${margin(["scoping"])} tokens on the shortest`);
    expect(flat).toContain(`and ${margin(["research", "stakeholder", "risk", "options", "adversarial"])} on the shortest search stage`);
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
    const step0 = commands[0] as { cap: number; ids: string[] };
    const noRetry = capWalk(mock(PROBE), false, once, step0.cap);
    if (noRetry.refusedAt === "synthesis-rerun") {
      expect(flat).toContain(`Without that retry the high case yields a brief under ${usd(step0.cap).replace(".00", "")}, with its synthesis rerun skipped at ${usd(noRetry.spent)}`);
    } else {
      expect(noRetry.refusedAt).toBeNull();
      expect(flat).toContain(`Without that retry the high case completes under ${usd(step0.cap).replace(".00", "")}`);
    }
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
    const batchCall = perCall("claude-opus-5") / 2;
    expect(flat).toContain(`${usd(batchCall)} per briefing, ${usd(5 * batchCall)} for the five`);
    expect(flat).toContain(`Expected ≈ ${usd(5 * batchCall)} for the five; \`<n>\` at most ${usd(10 * batchCall)} (2× margin)`);
  });

  test("its step 0 comparisons are the estimator's", () => {
    const [q05] = estimateRun(".", [PROBE]).rows;
    const [q11] = estimateRun(".", ["11-family-office-co-investment"]).rows;
    const [q12] = estimateRun(".", ["12-sodium-ion-plant-morocco"]).rows;
    expect(doc.replace(/\s+/g, " ")).toContain(`Question 11 is ${usd((q05?.central ?? 0) - (q11?.central ?? 0))} cheaper`);
    for (const k of ["low", "central", "high"] as const) expect(Math.abs((q12?.[k] ?? 0) - (q05?.[k] ?? 0))).toBeLessThan(0.015);
  });
});
