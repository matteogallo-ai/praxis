#!/usr/bin/env bun
/**
 * benchmarks/score-all.ts — v0.10 AI-assisted qualitative scoring.
 *
 * For every briefing under `benchmarks/outputs/{mock,live}/*` this
 * script:
 *
 *   1. Loads `brief.md` (the Markdown briefing) and `metadata.json`
 *      (the audit trail).
 *   2. Interpolates `benchmarks/scoring-prompt.txt` with the
 *      briefing content + metadata.
 *   3. Calls `AnthropicLLMProvider.complete()` on
 *      `claude-sonnet-4-5` and expects the calibrated 7-criterion
 *      JSON payload back.
 *   4. Validates the payload structurally
 *      (`parseScoringPayload()`) — the score for every criterion is
 *      an integer in [1, 5], `total` equals the sum, `provider` is
 *      one of {mock, anthropic}.
 *   5. Caches the parsed payload under
 *      `benchmarks/.scoring-cache/{slug}-{mode}.json`. Cache TTL:
 *      24 hours by default.
 *   6. Aggregates every parsed score per criterion, mode, and
 *      overall, and rewrites the "AI-Assisted Qualitative Scoring"
 *      section in `benchmarks/RESULTS.md` (the v0.9 objective-
 *      checks block is preserved verbatim).
 *
 * Flags:
 *   default          — score mock + live (skipping the modes with
 *                      no output directory).
 *   --mock-only      — score mock only.
 *   --live-only      — score live only; error if no live outputs.
 *   --refresh <slug> — ignore the cache for this slug (mock+live
 *                      variants both refreshed).
 *   --dry-run        — enumerate briefings, print what WOULD be
 *                      scored, do NOT call the API. Exit 0.
 *   --root <path>    — override the repo root (used by tests).
 *
 * ANTHROPIC_API_KEY is required for non-dry runs. When absent, the
 * script emits a structured error naming the missing env var and
 * pointing at docs/benchmarking-methodology.md.
 *
 * v0.10.0 SHIPS THE FRAMEWORK ONLY. Empirical numbers land in
 * v0.10.1, when a maintainer with API credits runs this script and
 * commits the resulting RESULTS.md diff.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { AnthropicLLMProvider } from "../src/llm/anthropic-provider.ts";
import type { LLMProvider } from "../src/llm/provider.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScoringMode = "mock" | "live";

/** The seven-criterion rubric used by the scoring prompt. */
export const SCORING_CRITERIA = [
  "framing_clarity",
  "non_hedging",
  "decisive_recommendation",
  "concrete_tradeoffs",
  "perceived_sourcing",
  "adversarial_usefulness",
  "format_fidelity",
] as const;
export type ScoringCriterion = (typeof SCORING_CRITERIA)[number];

/** Human-readable labels used in RESULTS.md tables. */
export const CRITERION_LABELS: Record<ScoringCriterion, string> = {
  framing_clarity: "Framing clarity",
  non_hedging: "Non-hedging",
  decisive_recommendation: "Decisive recommendation",
  concrete_tradeoffs: "Concrete tradeoffs",
  perceived_sourcing: "Perceived sourcing",
  adversarial_usefulness: "Adversarial usefulness",
  format_fidelity: "Format fidelity",
};

export interface CriterionScore {
  score: number;
  example: string;
  improvement: string;
}

export interface ScoringPayload {
  briefing_id: string;
  provider: "mock" | "anthropic";
  format_id: string;
  scores: Record<ScoringCriterion, CriterionScore>;
  total: number;
  weakest_aspect: string;
  strongest_aspect: string;
  comparative_note: string;
}

export interface CachedScoring {
  cached_at: string;
  payload: ScoringPayload;
}

export interface ScoreAllOptions {
  mockOnly: boolean;
  liveOnly: boolean;
  refresh: string | null;
  dryRun: boolean;
  root: string;
  /** Cache freshness window; default 24h. Exposed for tests. */
  cacheTtlMs: number;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export function parseScoreArgs(argv: readonly string[]): ScoreAllOptions {
  let mockOnly = false;
  let liveOnly = false;
  let refresh: string | null = null;
  let dryRun = false;
  let root = resolve(import.meta.dir, "..");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--mock-only") mockOnly = true;
    else if (a === "--live-only") liveOnly = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--refresh") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--refresh expects a slug");
      refresh = next;
      i++;
    } else if (a.startsWith("--refresh=")) {
      refresh = a.slice("--refresh=".length);
    } else if (a === "--root") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--root expects a path");
      root = resolve(next);
      i++;
    } else if (a.startsWith("--root=")) {
      root = resolve(a.slice("--root=".length));
    } else {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  if (mockOnly && liveOnly) {
    throw new Error("--mock-only and --live-only are mutually exclusive");
  }
  return {
    mockOnly,
    liveOnly,
    refresh,
    dryRun,
    root,
    cacheTtlMs: 24 * 60 * 60 * 1000,
  };
}

// ---------------------------------------------------------------------------
// Enumeration of briefings on disk
// ---------------------------------------------------------------------------

export interface BriefingRef {
  slug: string;
  mode: ScoringMode;
  dir: string;
  brief_md_path: string;
  metadata_path: string;
}

export function enumerateBriefings(
  root: string,
  opts: { mockOnly: boolean; liveOnly: boolean }
): BriefingRef[] {
  const modes: ScoringMode[] = opts.mockOnly
    ? ["mock"]
    : opts.liveOnly
      ? ["live"]
      : ["mock", "live"];
  const found: BriefingRef[] = [];
  for (const mode of modes) {
    const parent = join(root, "benchmarks", "outputs", mode);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) continue;
    for (const slug of readdirSync(parent).sort()) {
      const dir = join(parent, slug);
      // Skip stray files at the top level (e.g. README.md, .gitkeep).
      if (!statSync(dir).isDirectory()) continue;
      const briefPath = join(dir, "brief.md");
      const metaPath = join(dir, "metadata.json");
      if (!existsSync(briefPath) || !existsSync(metaPath)) continue;
      found.push({
        slug,
        mode,
        dir,
        brief_md_path: briefPath,
        metadata_path: metaPath,
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Prompt interpolation
// ---------------------------------------------------------------------------

interface BriefingMetadata {
  id: string;
  question: string;
  format: string;
  mode: string;
}

export function interpolateScoringPrompt(
  template: string,
  ref: BriefingRef,
  meta: BriefingMetadata,
  briefingMarkdown: string
): string {
  return template
    .replace("{briefing_id}", meta.id)
    .replace("{provider}", ref.mode === "mock" ? "mock" : "anthropic")
    .replace("{format_id}", meta.format)
    .replace("{question}", meta.question)
    .replace("{briefing_markdown}", briefingMarkdown);
}

// ---------------------------------------------------------------------------
// Parser + validation
// ---------------------------------------------------------------------------

export class ScoringParseError extends Error {
  constructor(message: string) {
    super(`Scoring payload rejected: ${message}`);
    this.name = "ScoringParseError";
  }
}

export function parseScoringPayload(raw: unknown): ScoringPayload {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ScoringParseError("expected a JSON object at the top level");
  }
  const o = raw as Record<string, unknown>;

  const briefing_id = requireString(o, "briefing_id");
  const providerRaw = requireString(o, "provider");
  if (providerRaw !== "mock" && providerRaw !== "anthropic") {
    throw new ScoringParseError(
      `'provider' must be 'mock' or 'anthropic', got '${providerRaw}'`
    );
  }
  const format_id = requireString(o, "format_id");
  const weakest_aspect = requireString(o, "weakest_aspect");
  const strongest_aspect = requireString(o, "strongest_aspect");
  const comparative_note = requireString(o, "comparative_note");

  const scoresRaw = o["scores"];
  if (
    typeof scoresRaw !== "object" ||
    scoresRaw === null ||
    Array.isArray(scoresRaw)
  ) {
    throw new ScoringParseError("'scores' must be an object");
  }
  const scoresObj = scoresRaw as Record<string, unknown>;
  const scores: Record<ScoringCriterion, CriterionScore> = {} as Record<
    ScoringCriterion,
    CriterionScore
  >;
  let computedTotal = 0;
  for (const key of SCORING_CRITERIA) {
    const v = scoresObj[key];
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      throw new ScoringParseError(`'scores.${key}' must be an object`);
    }
    const c = v as Record<string, unknown>;
    const score = c["score"];
    if (typeof score !== "number" || !Number.isInteger(score)) {
      throw new ScoringParseError(
        `'scores.${key}.score' must be an integer, got ${typeof score}`
      );
    }
    if (score < 1 || score > 5) {
      throw new ScoringParseError(
        `'scores.${key}.score' must be in [1, 5], got ${score}`
      );
    }
    const example = requireString(c, "example");
    const improvement = requireString(c, "improvement");
    scores[key] = { score, example, improvement };
    computedTotal += score;
  }

  const total = o["total"];
  if (typeof total !== "number" || !Number.isInteger(total)) {
    throw new ScoringParseError("'total' must be an integer");
  }
  if (total !== computedTotal) {
    throw new ScoringParseError(
      `'total' (${total}) does not equal the sum of criterion scores (${computedTotal})`
    );
  }

  return {
    briefing_id,
    provider: providerRaw,
    format_id,
    scores,
    total,
    weakest_aspect,
    strongest_aspect,
    comparative_note,
  };
}

function requireString(o: Record<string, unknown>, key: string): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ScoringParseError(`'${key}' must be a non-empty string`);
  }
  return v;
}

/**
 * Extract the JSON object out of an LLM response that may include
 * prose. We tolerate ```json fences and leading/trailing whitespace;
 * anything less structural throws.
 */
export function extractJsonBody(text: string): string {
  const fenced = text.match(/```(?:json)?\n([\s\S]*?)\n```/);
  if (fenced && fenced[1] !== undefined) return fenced[1].trim();
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  // Fall back to the first `{...}` block.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new ScoringParseError("no JSON object found in LLM response");
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export interface CriterionAggregate {
  mock_avg: number | null;
  mock_n: number;
  live_avg: number | null;
  live_n: number;
  delta: number | null;
}

export interface Aggregates {
  by_criterion: Record<ScoringCriterion, CriterionAggregate>;
  total_mock_avg: number | null;
  total_live_avg: number | null;
  total_delta: number | null;
  mock_n: number;
  live_n: number;
}

export function aggregate(scorings: readonly ScoringPayload[]): Aggregates {
  const mock = scorings.filter((s) => s.provider === "mock");
  const live = scorings.filter((s) => s.provider === "anthropic");

  const by_criterion: Record<ScoringCriterion, CriterionAggregate> = {} as Record<
    ScoringCriterion,
    CriterionAggregate
  >;
  for (const c of SCORING_CRITERIA) {
    const mockScores = mock.map((s) => s.scores[c].score);
    const liveScores = live.map((s) => s.scores[c].score);
    const mock_avg = mockScores.length > 0 ? mean(mockScores) : null;
    const live_avg = liveScores.length > 0 ? mean(liveScores) : null;
    by_criterion[c] = {
      mock_avg,
      mock_n: mockScores.length,
      live_avg,
      live_n: liveScores.length,
      delta:
        mock_avg !== null && live_avg !== null
          ? round1(live_avg - mock_avg)
          : null,
    };
  }

  const mockTotals = mock.map((s) => s.total);
  const liveTotals = live.map((s) => s.total);
  const total_mock_avg = mockTotals.length > 0 ? mean(mockTotals) : null;
  const total_live_avg = liveTotals.length > 0 ? mean(liveTotals) : null;
  return {
    by_criterion,
    total_mock_avg,
    total_live_avg,
    total_delta:
      total_mock_avg !== null && total_live_avg !== null
        ? round1(total_live_avg - total_mock_avg)
        : null,
    mock_n: mock.length,
    live_n: live.length,
  };
}

function mean(xs: readonly number[]): number {
  return round1(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// ---------------------------------------------------------------------------
// Systematic observations
// ---------------------------------------------------------------------------

export interface SystematicObservations {
  live_outperforms: string[];
  mock_holds_close: string[];
  weakest_aspect: string;
  strongest_aspect: string;
  verdict: string[];
}

export function computeObservations(
  agg: Aggregates,
  scorings: readonly ScoringPayload[]
): SystematicObservations {
  const outperforms: string[] = [];
  const holdsClose: string[] = [];
  for (const c of SCORING_CRITERIA) {
    const a = agg.by_criterion[c];
    if (a.delta === null) continue;
    if (a.delta >= 1.0) {
      outperforms.push(`${CRITERION_LABELS[c]} (+${a.delta.toFixed(1)})`);
    } else if (a.delta < 0.5) {
      holdsClose.push(`${CRITERION_LABELS[c]} (Δ=${a.delta.toFixed(1)})`);
    }
  }

  let weakestKey: ScoringCriterion | null = null;
  let weakestVal = Number.POSITIVE_INFINITY;
  let strongestKey: ScoringCriterion | null = null;
  let strongestVal = Number.NEGATIVE_INFINITY;
  for (const c of SCORING_CRITERIA) {
    const a = agg.by_criterion[c];
    const overallVals: number[] = [];
    if (a.mock_avg !== null) overallVals.push(a.mock_avg);
    if (a.live_avg !== null) overallVals.push(a.live_avg);
    if (overallVals.length === 0) continue;
    const overall = mean(overallVals);
    if (overall < weakestVal) {
      weakestVal = overall;
      weakestKey = c;
    }
    if (overall > strongestVal) {
      strongestVal = overall;
      strongestKey = c;
    }
  }

  const verdict: string[] = [];
  if (agg.total_mock_avg !== null) {
    verdict.push(
      `Mock briefings average ${agg.total_mock_avg.toFixed(1)}/35 (n=${agg.mock_n}).`
    );
  }
  if (agg.total_live_avg !== null) {
    verdict.push(
      `Live briefings average ${agg.total_live_avg.toFixed(1)}/35 (n=${agg.live_n}).`
    );
  }
  if (agg.total_delta !== null) {
    verdict.push(
      `Delta of ${signed(agg.total_delta)} is the empirical spread between MockLLMProvider and Anthropic API.`
    );
  }
  const floor = 15;
  const ceiling = 32;
  const belowFloor = scorings.filter((s) => s.total < floor).length;
  const aboveCeiling = scorings.filter((s) => s.total >= ceiling).length;
  verdict.push(
    `${belowFloor} briefing(s) below the ${floor}/35 usability floor; ${aboveCeiling} at or above the ${ceiling}/35 near-excellence line.`
  );

  return {
    live_outperforms: outperforms,
    mock_holds_close: holdsClose,
    weakest_aspect:
      weakestKey !== null
        ? `${CRITERION_LABELS[weakestKey]} (overall ${weakestVal.toFixed(1)}/5)`
        : "n/a",
    strongest_aspect:
      strongestKey !== null
        ? `${CRITERION_LABELS[strongestKey]} (overall ${strongestVal.toFixed(1)}/5)`
        : "n/a",
    verdict,
  };
}

function signed(x: number): string {
  return x >= 0 ? `+${x.toFixed(1)}` : x.toFixed(1);
}

// ---------------------------------------------------------------------------
// RESULTS.md rewriter
// ---------------------------------------------------------------------------

/**
 * Splice the "AI-Assisted Qualitative Scoring" block into an
 * existing RESULTS.md, preserving everything above and below.
 * Idempotent: repeat calls REPLACE the block, they don't
 * concatenate.
 */
export function insertScoringSection(
  existingResults: string,
  scoringBlock: string
): string {
  const marker = "## AI-Assisted Qualitative Scoring";
  const startIdx = existingResults.indexOf(marker);
  if (startIdx === -1) {
    // Append at the end.
    const sep = existingResults.endsWith("\n") ? "\n" : "\n\n";
    return existingResults + sep + scoringBlock + "\n";
  }
  // Find the next top-level "## " AFTER our marker to bound the block.
  const afterStart = existingResults.indexOf("\n## ", startIdx + marker.length);
  const before = existingResults.slice(0, startIdx);
  const after = afterStart === -1 ? "" : existingResults.slice(afterStart + 1);
  return before + scoringBlock + (after.length > 0 ? "\n" + after : "\n");
}

export function renderScoringSection(
  scorings: readonly ScoringPayload[],
  agg: Aggregates,
  obs: SystematicObservations,
  isoDate: string
): string {
  const lines: string[] = [];
  lines.push(`## AI-Assisted Qualitative Scoring (${isoDate})`);
  lines.push("");
  lines.push(
    "Scored by Claude Sonnet 4.5 via the calibrated rubric in `scoring-prompt.txt`. See `docs/benchmarking-methodology.md` for the methodology, model choice, and known biases."
  );
  lines.push("");
  lines.push("### Aggregate scores");
  lines.push("");
  lines.push("| Criterion | Mock (n) | Live (n) | Delta |");
  lines.push("|---|---|---|---|");
  for (const c of SCORING_CRITERIA) {
    const a = agg.by_criterion[c];
    lines.push(
      `| ${CRITERION_LABELS[c]} | ${cell(a.mock_avg, a.mock_n)} | ${cell(a.live_avg, a.live_n)} | ${deltaCell(a.delta)} |`
    );
  }
  lines.push(
    `| **Total /35** | **${cell(agg.total_mock_avg, agg.mock_n)}** | **${cell(agg.total_live_avg, agg.live_n)}** | **${deltaCell(agg.total_delta)}** |`
  );
  lines.push("");
  lines.push("### Per-briefing scores");
  lines.push("");
  lines.push("| # | Slug | Format | Mock | Live | Delta |");
  lines.push("|---|---|---|---|---|---|");
  const bySlug = new Map<string, { mock?: ScoringPayload; live?: ScoringPayload; format: string }>();
  for (const s of scorings) {
    const cur = bySlug.get(s.briefing_id) ?? { format: s.format_id };
    if (s.provider === "mock") cur.mock = s;
    else cur.live = s;
    cur.format = s.format_id;
    bySlug.set(s.briefing_id, cur);
  }
  const sortedSlugs = [...bySlug.keys()].sort();
  for (const [i, slug] of sortedSlugs.entries()) {
    const rec = bySlug.get(slug)!;
    const num = String(i + 1).padStart(2, "0");
    const mockCell = rec.mock !== undefined ? String(rec.mock.total) : "—";
    const liveCell = rec.live !== undefined ? String(rec.live.total) : "—";
    const delta =
      rec.mock !== undefined && rec.live !== undefined
        ? signed(rec.live.total - rec.mock.total)
        : "—";
    lines.push(`| ${num} | ${slug} | ${rec.format} | ${mockCell} | ${liveCell} | ${delta} |`);
  }
  lines.push("");
  lines.push("### Systematic observations");
  lines.push("");
  lines.push(
    `**Where live significantly outperforms mock (Δ ≥ +1.0):** ${obs.live_outperforms.length > 0 ? obs.live_outperforms.join("; ") : "none observed."}`
  );
  lines.push("");
  lines.push(
    `**Where mock holds close (Δ < +0.5):** ${obs.mock_holds_close.length > 0 ? obs.mock_holds_close.join("; ") : "none observed."}`
  );
  lines.push("");
  lines.push(`**Weakest aspect across all briefings:** ${obs.weakest_aspect}.`);
  lines.push("");
  lines.push(`**Strongest aspect across all briefings:** ${obs.strongest_aspect}.`);
  lines.push("");
  lines.push("**Overall verdict:**");
  lines.push("");
  for (const v of obs.verdict) {
    lines.push(`- ${v}`);
  }
  lines.push("");
  return lines.join("\n");
}

function cell(avg: number | null, n: number): string {
  if (avg === null) return "—";
  return `${avg.toFixed(1)} (n=${n})`;
}

function deltaCell(d: number | null): string {
  if (d === null) return "—";
  return signed(d);
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

function cachePath(root: string, slug: string, mode: ScoringMode): string {
  return join(root, "benchmarks", ".scoring-cache", `${slug}-${mode}.json`);
}

export function readCache(
  root: string,
  slug: string,
  mode: ScoringMode,
  ttlMs: number,
  now: number = Date.now()
): ScoringPayload | null {
  const path = cachePath(root, slug, mode);
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    return null;
  }
  const c = parsed as { cached_at?: unknown; payload?: unknown };
  if (typeof c.cached_at !== "string") return null;
  const cachedAt = Date.parse(c.cached_at);
  if (!Number.isFinite(cachedAt)) return null;
  if (now - cachedAt > ttlMs) return null;
  try {
    return parseScoringPayload(c.payload);
  } catch {
    return null;
  }
}

export function writeCache(
  root: string,
  slug: string,
  mode: ScoringMode,
  payload: ScoringPayload
): void {
  const dir = join(root, "benchmarks", ".scoring-cache");
  mkdirSync(dir, { recursive: true });
  const record: CachedScoring = {
    cached_at: new Date().toISOString(),
    payload,
  };
  writeFileSync(cachePath(root, slug, mode), JSON.stringify(record, null, 2));
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

export interface ScoreAllReport {
  scored: number;
  from_cache: number;
  errors: number;
  results_md_path: string | null;
  scorings: ScoringPayload[];
}

export async function scoreAll(opts: ScoreAllOptions): Promise<ScoreAllReport> {
  const templatePath = join(opts.root, "benchmarks", "scoring-prompt.txt");
  if (!existsSync(templatePath)) {
    throw new Error(
      `scoring prompt template missing at ${templatePath}. See docs/benchmarking-methodology.md.`
    );
  }
  const template = readFileSync(templatePath, "utf-8");

  const refs = enumerateBriefings(opts.root, {
    mockOnly: opts.mockOnly,
    liveOnly: opts.liveOnly,
  });

  if (opts.liveOnly && refs.filter((r) => r.mode === "live").length === 0) {
    throw new Error(
      "--live-only: no live briefings under benchmarks/outputs/live/. Run `bun run bench:live` first."
    );
  }

  if (opts.dryRun) {
    process.stderr.write(
      `→ dry-run: would score ${refs.length} briefing(s) using claude-sonnet-4-5\n`
    );
    for (const r of refs) {
      process.stderr.write(`  · [${r.mode}] ${r.slug} → ${r.brief_md_path}\n`);
    }
    process.stderr.write(
      `(no API call issued; --dry-run does not require ANTHROPIC_API_KEY)\n`
    );
    return {
      scored: 0,
      from_cache: 0,
      errors: 0,
      results_md_path: null,
      scorings: [],
    };
  }

  // Non-dry-run: require the key.
  if (
    typeof process.env["ANTHROPIC_API_KEY"] !== "string" ||
    process.env["ANTHROPIC_API_KEY"]!.length === 0
  ) {
    process.stderr.write(
      "✗ AI scoring requires ANTHROPIC_API_KEY. Set it in .env or export in shell. See docs/benchmarking-methodology.md.\n"
    );
    throw new Error("ANTHROPIC_API_KEY missing");
  }

  const llm: LLMProvider = new AnthropicLLMProvider({ model: "claude-sonnet-4-5" });
  const scorings: ScoringPayload[] = [];
  let scored = 0;
  let fromCache = 0;
  let errors = 0;

  for (const ref of refs) {
    const shouldRefresh = opts.refresh !== null && opts.refresh === ref.slug;
    if (!shouldRefresh) {
      const cached = readCache(opts.root, ref.slug, ref.mode, opts.cacheTtlMs);
      if (cached !== null) {
        scorings.push(cached);
        fromCache += 1;
        process.stderr.write(`  ✓ [${ref.mode}] ${ref.slug} (cached, score=${cached.total}/35)\n`);
        continue;
      }
    }
    try {
      const metaRaw = JSON.parse(readFileSync(ref.metadata_path, "utf-8"));
      const meta: BriefingMetadata = {
        id: String(metaRaw.id ?? ref.slug),
        question: String(metaRaw.question ?? "(unknown question)"),
        format: String(metaRaw.format ?? "(unknown format)"),
        mode: ref.mode,
      };
      const briefingMarkdown = readFileSync(ref.brief_md_path, "utf-8");
      const prompt = interpolateScoringPrompt(template, ref, meta, briefingMarkdown);
      const raw = await llm.complete!(prompt);
      const body = extractJsonBody(raw);
      const parsed = parseScoringPayload(JSON.parse(body));
      scorings.push(parsed);
      writeCache(opts.root, ref.slug, ref.mode, parsed);
      scored += 1;
      process.stderr.write(`  ✓ [${ref.mode}] ${ref.slug} (score=${parsed.total}/35)\n`);
    } catch (err) {
      errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  ✗ [${ref.mode}] ${ref.slug} — ${message}\n`);
    }
  }

  // Rewrite RESULTS.md when at least one scoring came in.
  let resultsPath: string | null = null;
  if (scorings.length > 0) {
    resultsPath = join(opts.root, "benchmarks", "RESULTS.md");
    const existing = existsSync(resultsPath)
      ? readFileSync(resultsPath, "utf-8")
      : "# Benchmark results\n";
    const agg = aggregate(scorings);
    const obs = computeObservations(agg, scorings);
    const iso = new Date().toISOString().slice(0, 10);
    const block = renderScoringSection(scorings, agg, obs, iso);
    const next = insertScoringSection(existing, block);
    writeFileSync(resultsPath, next);
  }

  return { scored, from_cache: fromCache, errors, results_md_path: resultsPath, scorings };
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const opts = parseScoreArgs(process.argv.slice(2));
  const report = await scoreAll(opts);
  process.stderr.write(
    `\n== scored=${report.scored} cached=${report.from_cache} errors=${report.errors} ==\n`
  );
  if (report.results_md_path !== null) {
    process.stderr.write(`   wrote ${report.results_md_path}\n`);
  }
  process.exit(report.errors === 0 ? 0 : 1);
}
