#!/usr/bin/env bun
/**
 * Estimates what a live benchmark run costs before anyone pays for it.
 *
 * No live briefing has completed, so nothing measured exists to multiply.
 * The estimate is built from what the repository does know, each piece
 * named in `SCENARIOS`:
 *   - the size of each stage's rendered prompt, measured on the committed
 *     mock run of the same question (`usage.stages.<stage>.input_tokens`,
 *     4 characters per token), scaled by how much longer live upstream
 *     outputs may be than the fixtures (`upstreamGrowth`);
 *   - each stage's model (`@model`, recorded in the mock metadata), output
 *     ceiling and web-search cap (`src/agents/stage-limits.ts`);
 *   - the price table (`src/llm/pricing.ts`).
 * A web-searching call re-reads its context after each search, so with
 * `s` searches of `r` tokens each and output `O` spread over the `s+1`
 * rounds, its input is (s+1)·P + r·s(s+1)/2 + O·s/2.
 *
 *   bun run estimate:cost -- --ids 02-cfo-buyback-briefing,12-sodium-ion-plant-morocco
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseUsd } from "../src/cli/run-args.ts";
import { stageLimits } from "../src/agents/stage-limits.ts";
import { costOf, DEFAULT_PRICE_TABLE, type PriceTable } from "../src/llm/pricing.ts";
import type { TokenUsage } from "../src/llm/types.ts";

export interface Scenario {
  name: "low" | "central" | "high";
  /** Live prompt size over mock prompt size (upstream outputs are longer live). */
  upstreamGrowth: number;
  /** Searches per web-searching call (each stage caps at `max_uses`). */
  searches: number;
  /** Tokens one search adds to the context. */
  tokensPerSearch: number;
  /** Share of `max_tokens` each call writes, thinking included. */
  outputShare: number;
  /** Synthesis passes per section under `strict_editorial`, the cap included. */
  strictEditorialPasses: number;
  /** Whether the synthesis rerun is counted: "as-mock" follows the mock run. */
  rerun: boolean | "as-mock";
  /** Extra full runs of the costliest stage (one stage retry). */
  stageRetries: number;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "low",
    upstreamGrowth: 1,
    searches: 2,
    tokensPerSearch: 3_000,
    outputShare: 0.25,
    strictEditorialPasses: 1,
    rerun: false,
    stageRetries: 0,
  },
  {
    name: "central",
    upstreamGrowth: 2,
    searches: 5,
    tokensPerSearch: 8_000,
    outputShare: 0.5,
    strictEditorialPasses: 1.5,
    rerun: "as-mock",
    stageRetries: 0,
  },
  {
    name: "high",
    upstreamGrowth: 3,
    searches: 5,
    tokensPerSearch: 15_000,
    outputShare: 1,
    strictEditorialPasses: 2,
    rerun: true,
    stageRetries: 1,
  },
];

interface MockStage {
  calls: number;
  input_tokens: number;
  models: string[];
}

export interface MockMetadata {
  id: string;
  rerun: { performed: boolean };
  usage: { stages: Record<string, MockStage> };
}

function usage(input: number, output: number, searches: number): TokenUsage {
  return {
    input_tokens: Math.round(input),
    output_tokens: Math.round(output),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    web_search_requests: searches,
  };
}

/** USD per stage and in total for one briefing under `scenario`. */
export function estimateBriefing(
  meta: MockMetadata,
  strictEditorial: boolean,
  scenario: Scenario,
  prices: PriceTable = DEFAULT_PRICE_TABLE
): { stages: Record<string, number>; total: number } {
  const stages: Record<string, number> = {};
  const measured = { ...meta.usage.stages };
  // The mock may not have rerun; a scenario that counts a rerun prices it as
  // a second synthesis pass.
  const synthesis = measured["synthesis"];
  if (scenario.rerun === true && measured["synthesis-rerun"] === undefined && synthesis !== undefined) {
    measured["synthesis-rerun"] = synthesis;
  }
  for (const [stage, mock] of Object.entries(measured)) {
    if (stage === "synthesis-rerun") {
      const counted = scenario.rerun === "as-mock" ? meta.rerun.performed : scenario.rerun;
      if (!counted) continue;
    }
    // The rerun is a second synthesis pass, with synthesis's limits.
    const limits = stageLimits(stage === "synthesis-rerun" ? "synthesis" : stage);
    const model = mock.models[0];
    if (model === undefined) throw new Error(`${meta.id}: stage '${stage}' records no model`);
    const prompt = (mock.input_tokens / mock.calls) * scenario.upstreamGrowth;
    const output = limits.maxTokens * scenario.outputShare;
    const s = Math.min(scenario.searches, limits.maxSearches);
    const input = (s + 1) * prompt + (scenario.tokensPerSearch * s * (s + 1)) / 2 + (output * s) / 2;
    const passes = stage.startsWith("synthesis") && strictEditorial ? scenario.strictEditorialPasses : 1;
    const perCall = costOf(usage(input, output, s), model, prices);
    if (perCall === null) throw new Error(`${meta.id}: no price for model '${model}'`);
    stages[stage] = perCall * mock.calls * passes;
  }
  const costliest = Math.max(...Object.values(stages));
  const total = Object.values(stages).reduce((a, b) => a + b, 0) + costliest * scenario.stageRetries;
  return { stages, total };
}

/** Formats whose synthesis regenerates a section that breaks the editorial rules. */
function strictFormats(root: string): Set<string> {
  const strict = new Set<string>();
  const dir = join(root, "formats");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".yaml"))) {
    const text = readFileSync(join(dir, file), "utf-8");
    if (/^\s*strict_editorial:\s*true\s*$/m.test(text)) strict.add(file.slice(0, -".yaml".length));
  }
  return strict;
}

export function estimateRun(
  root: string,
  ids: readonly string[]
): { rows: { id: string; low: number; central: number; high: number }[]; totals: Record<Scenario["name"], number> } {
  const strict = strictFormats(root);
  const rows = ids.map((id) => {
    const meta = readMock(root, id);
    const [low, central, high] = SCENARIOS.map((s) => estimateBriefing(meta, strict.has(meta.format), s).total);
    return { id, low: low ?? 0, central: central ?? 0, high: high ?? 0 };
  });
  const sum = (k: "low" | "central" | "high") => rows.reduce((a, r) => a + r[k], 0);
  return { rows, totals: { low: sum("low"), central: sum("central"), high: sum("high") } };
}

export interface Ceiling {
  /** Costliest single request of any question, high scenario: the overshoot past the cap. */
  maxRequest: number;
  /** Briefings × (cap + maxRequest). */
  metered: number;
  /** Per question: every request timing out on both attempts, unseen by the cap. */
  unmetered: Record<string, number>;
  /** metered + every question's unmetered. */
  worst: number;
}

/**
 * What a capped live run can cost beyond its estimate, high scenario. The
 * cap stops the next request, so a briefing ends above it by at most the
 * request in flight; a timed-out request reports no usage, so up to two per
 * stage call (one per attempt) escape the cap.
 */
export function ceiling(root: string, ids: readonly string[], capUsd: number): Ceiling {
  const high = SCENARIOS.find((s) => s.name === "high") as Scenario;
  const once = { ...high, stageRetries: 0 };
  const strict = strictFormats(root);
  let maxRequest = 0;
  const unmetered: Record<string, number> = {};
  for (const id of ids) {
    const meta = readMock(root, id);
    const perRequest = {
      ...meta,
      usage: {
        stages: Object.fromEntries(
          Object.entries(meta.usage.stages).map(([k, v]) => [k, { ...v, calls: 1, input_tokens: v.input_tokens / v.calls }])
        ),
      },
    };
    maxRequest = Math.max(maxRequest, ...Object.values(estimateBriefing(perRequest, false, high).stages));
    unmetered[id] = 2 * estimateBriefing(meta, strict.has(meta.format), once).total;
  }
  const metered = ids.length * (capUsd + maxRequest);
  return { maxRequest, metered, unmetered, worst: metered + Object.values(unmetered).reduce((a, b) => a + b, 0) };
}

function readMock(root: string, id: string): MockMetadata & { format: string } {
  const path = join(root, "benchmarks", "outputs", "mock", id, "metadata.json");
  return JSON.parse(readFileSync(path, "utf-8")) as MockMetadata & { format: string };
}

if (import.meta.main) {
  const arg = (name: string) => {
    const at = process.argv.indexOf(name);
    return at === -1 ? undefined : process.argv[at + 1];
  };
  const list = arg("--ids");
  const cap = arg("--cap-usd") === undefined ? undefined : parseUsd(arg("--cap-usd"));
  if (list === undefined || list.length === 0 || (arg("--cap-usd") !== undefined && cap === undefined)) {
    process.stderr.write("usage: bun run estimate:cost -- --ids <id,id,…> [--cap-usd <positive number>]\n");
    process.exit(2);
  }
  const root = resolve(import.meta.dir, "..");
  const ids = list.split(",");
  const { rows, totals } = estimateRun(root, ids);
  const usd = (n: number) => `$${n.toFixed(2)}`;
  process.stdout.write("| Question | Low | Central | High |\n| --- | ---: | ---: | ---: |\n");
  for (const r of rows) process.stdout.write(`| ${r.id} | ${usd(r.low)} | ${usd(r.central)} | ${usd(r.high)} |\n`);
  process.stdout.write(`| **Total** | ${usd(totals.low)} | ${usd(totals.central)} | ${usd(totals.high)} |\n`);
  if (cap !== undefined) {
    const c = ceiling(root, ids, cap);
    process.stdout.write(`\ncostliest request ${usd(c.maxRequest)}; metered ceiling ${usd(c.metered)}\n`);
    for (const [id, v] of Object.entries(c.unmetered)) process.stdout.write(`unmetered timeouts ${id} ${usd(v)}\n`);
    process.stdout.write(`worst case ${usd(c.worst)}\n`);
  }
}
