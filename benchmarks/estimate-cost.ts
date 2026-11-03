#!/usr/bin/env bun
/**
 * Estimates what a live benchmark run costs before anyone pays for it.
 *
 * No live briefing has completed, so nothing measured exists to multiply.
 * The estimate is built from what the repository does know, each piece
 * named in `SCENARIOS`:
 *   - the size of each stage's rendered prompt, measured on the committed
 *     mock run of the same question (`usage.stages.<stage>.input_tokens`,
 *     which the mock counts at 4 characters per token), read at the ratio
 *     count_tokens measured (`benchmarks/token-counts/`), and scaled by how
 *     much longer live upstream outputs may be than the fixtures
 *     (`upstreamGrowth`);
 *   - each stage's model (`@model`, recorded in the mock metadata), output
 *     ceiling and web-search cap (`src/agents/stage-limits.ts`);
 *   - the price table (`src/llm/pricing.ts`).
 * Each call is priced by `requestCostUsd` (`src/llm/pricing.ts`), the
 * formula the budget cap reserves with.
 *
 *   bun run estimate:cost -- --ids 02-cfo-buyback-briefing,12-sodium-ion-plant-morocco
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseUsd } from "../src/cli/run-args.ts";
import { stageLimits } from "../src/agents/stage-limits.ts";
import {
  DEFAULT_PRICE_TABLE,
  type PriceTable,
  CHARS_PER_TOKEN_FLOOR,
  requestCostUsd,
  TOKENS_PER_SEARCH_CEILING,
} from "../src/llm/pricing.ts";

/** The mock's simulated usage counts 4 characters per token (`simulatedUsage`). */
export const MOCK_CHARS_PER_TOKEN = 4;

/**
 * Characters per token of the briefings measured with Anthropic's
 * count_tokens endpoint (`benchmarks/token-counts/*.json`): all their
 * characters over all their tokens. A record that is not a positive count
 * stops the estimate rather than turning it into NaN.
 */
export function measuredCharsPerToken(root: string): number {
  const dir = join(root, "benchmarks", "token-counts");
  if (!existsSync(dir)) throw new Error(`no measured token counts: ${dir} is missing`);
  let chars = 0;
  let tokens = 0;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    let requests: unknown;
    try {
      requests = (JSON.parse(readFileSync(join(dir, file), "utf-8")) as { requests?: unknown }).requests;
    } catch (err) {
      throw new Error(`${file}: not JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!Array.isArray(requests)) throw new Error(`${file}: no 'requests' array`);
    for (const r of requests as { chars?: unknown; tokens?: unknown }[]) {
      const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
      if (!ok(r.chars) || !ok(r.tokens)) throw new Error(`${file}: a request without positive 'chars' and 'tokens'`);
      chars += r.chars;
      tokens += r.tokens;
    }
  }
  if (tokens === 0) throw new Error(`no measured token counts under ${dir}`);
  return chars / tokens;
}

let measuredRatio: number | undefined;
/** Read on first use, so importing this module reads no file. */
function defaultCharsPerToken(): number {
  measuredRatio ??= measuredCharsPerToken(resolve(import.meta.dir, ".."));
  return measuredRatio;
}

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
    tokensPerSearch: TOKENS_PER_SEARCH_CEILING,
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

/** USD per stage and in total for one briefing under `scenario`. */
export function estimateBriefing(
  meta: MockMetadata,
  strictEditorial: boolean,
  scenario: Scenario,
  prices: PriceTable = DEFAULT_PRICE_TABLE,
  charsPerToken: number = defaultCharsPerToken()
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
    const passes = stage.startsWith("synthesis") && strictEditorial ? scenario.strictEditorialPasses : 1;
    const perCall = requestCostUsd(
      {
        promptTokens:
          ((mock.input_tokens / mock.calls) * MOCK_CHARS_PER_TOKEN * scenario.upstreamGrowth) / charsPerToken,
        outputTokens: limits.maxTokens * scenario.outputShare,
        searches: Math.min(scenario.searches, limits.maxSearches),
        tokensPerSearch: scenario.tokensPerSearch,
        outputRereadShare: 0.5,
      },
      model,
      prices
    );
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

export interface CapWalk {
  /** USD spent when the briefing completes or the cap refuses a request. */
  spent: number;
  /** The stage whose request the cap refuses, or `null` when the briefing completes. */
  refusedAt: string | null;
  /** The worst case one request of each stage reserves. */
  reservations: Record<string, number>;
}

/**
 * Walks one briefing through a capped ledger under `scenario`: before each
 * request the cap reserves its worst case (`requestCostUsd` at the stage's
 * `max_tokens` and `max_uses`, `TOKENS_PER_SEARCH_CEILING` per search, the
 * prompt at `CHARS_PER_TOKEN_FLOOR` characters per token), then the request
 * costs what the scenario says. Synthesis sections start together, so all of
 * a pass's sections must fit at once. The scenario's stage retry repeats the
 * costliest stage right after it. A refused `synthesis-rerun` leaves the
 * brief complete, with the rerun skipped.
 */
export function capWalk(
  meta: MockMetadata,
  strictEditorial: boolean,
  scenario: Scenario,
  capUsd: number,
  prices: PriceTable = DEFAULT_PRICE_TABLE
): CapWalk {
  const { stages } = estimateBriefing(meta, strictEditorial, scenario, prices);
  const costliest = Object.entries(stages).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  const reservations: Record<string, number> = {};
  let spent = 0;
  for (const stage of Object.keys(stages)) {
    const mock = meta.usage.stages[stage] ?? meta.usage.stages["synthesis"];
    if (mock === undefined) throw new Error(`${meta.id}: no mock record for stage '${stage}'`);
    const limits = stageLimits(stage === "synthesis-rerun" ? "synthesis" : stage);
    const model = mock.models[0] as string;
    // The cap sizes the prompt's characters at the floor.
    const chars = (mock.input_tokens / mock.calls) * MOCK_CHARS_PER_TOKEN * scenario.upstreamGrowth;
    const worst = requestCostUsd(
      {
        promptTokens: Math.ceil(chars / CHARS_PER_TOKEN_FLOOR),
        outputTokens: limits.maxTokens,
        searches: limits.maxSearches,
        tokensPerSearch: TOKENS_PER_SEARCH_CEILING,
        outputRereadShare: 1,
      },
      model,
      prices
    );
    if (worst === null) throw new Error(`${meta.id}: no price for model '${model}'`);
    reservations[stage] = worst;
    const concurrent = stage.startsWith("synthesis") ? mock.calls : 1;
    const passes = stage.startsWith("synthesis") && strictEditorial ? scenario.strictEditorialPasses : 1;
    const batches = (mock.calls / concurrent) * Math.ceil(passes);
    const perBatch = (stages[stage] ?? 0) / batches;
    const runs = stage === costliest ? 1 + scenario.stageRetries : 1;
    for (let k = 0; k < batches * runs; k++) {
      if (spent + concurrent * worst > capUsd + 1e-12) return { spent, refusedAt: stage, reservations };
      spent += perBatch;
    }
  }
  return { spent, refusedAt: null, reservations };
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
  const capGiven = process.argv.includes("--cap-usd");
  const cap = capGiven ? parseUsd(arg("--cap-usd")) : undefined;
  if (list === undefined || list.length === 0 || (capGiven && cap === undefined)) {
    process.stderr.write("usage: bun run estimate:cost -- --ids <id,id,…> [--cap-usd <positive decimal number>]\n");
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
    const strict = strictFormats(root);
    process.stdout.write(`\nUnder a $${cap} cap, each request reserving its worst case:\n`);
    for (const id of ids) {
      const meta = readMock(root, id);
      for (const scenario of SCENARIOS) {
        const w = capWalk(meta, strict.has(meta.format), scenario, cap);
        const outcome =
          w.refusedAt === null
            ? "completes"
            : w.refusedAt === "synthesis-rerun"
              ? "completes, rerun skipped"
              : `stops before ${w.refusedAt}`;
        process.stdout.write(`${id} ${scenario.name}: ${outcome} at ${usd(w.spent)}\n`);
      }
    }
  }

}
