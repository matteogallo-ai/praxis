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
 * `s` searches of `r` tokens each its input is (s+1)·P + r·s(s+1)/2.
 *
 *   bun run estimate:cost -- --ids 02-cfo-buyback-briefing,12-sodium-ion-plant-morocco
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
  for (const [stage, mock] of Object.entries(meta.usage.stages)) {
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
    const input = (s + 1) * prompt + (scenario.tokensPerSearch * s * (s + 1)) / 2;
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
  for (const id of ["executive-pre-read", "family-office-memo", "mckinsey-style-note", "position-paper-corporate"]) {
    const text = readFileSync(join(root, "formats", `${id}.yaml`), "utf-8");
    if (/^\s*strict_editorial:\s*true\s*$/m.test(text)) strict.add(id);
  }
  return strict;
}

export function estimateRun(
  root: string,
  ids: readonly string[]
): { rows: { id: string; low: number; central: number; high: number }[]; totals: Record<Scenario["name"], number> } {
  const strict = strictFormats(root);
  const rows = ids.map((id) => {
    const path = join(root, "benchmarks", "outputs", "mock", id, "metadata.json");
    const meta = JSON.parse(readFileSync(path, "utf-8")) as MockMetadata & { format: string };
    const [low, central, high] = SCENARIOS.map((s) => estimateBriefing(meta, strict.has(meta.format), s).total);
    return { id, low: low ?? 0, central: central ?? 0, high: high ?? 0 };
  });
  const sum = (k: "low" | "central" | "high") => rows.reduce((a, r) => a + r[k], 0);
  return { rows, totals: { low: sum("low"), central: sum("central"), high: sum("high") } };
}

if (import.meta.main) {
  const at = process.argv.indexOf("--ids");
  const list = at === -1 ? undefined : process.argv[at + 1];
  if (list === undefined || list.length === 0) {
    process.stderr.write("usage: bun run estimate:cost -- --ids <id,id,…>\n");
    process.exit(2);
  }
  const { rows, totals } = estimateRun(resolve(import.meta.dir, ".."), list.split(","));
  const usd = (n: number) => `$${n.toFixed(2)}`;
  process.stdout.write("| Question | Low | Central | High |\n| --- | ---: | ---: | ---: |\n");
  for (const r of rows) process.stdout.write(`| ${r.id} | ${usd(r.low)} | ${usd(r.central)} | ${usd(r.high)} |\n`);
  process.stdout.write(`| **Total** | ${usd(totals.low)} | ${usd(totals.central)} | ${usd(totals.high)} |\n`);
}
