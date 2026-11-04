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
 *   3. Sends every briefing not in the cache to `JUDGE_MODEL` as one
 *      Message Batch (`judge-batch.ts`), after reserving the batch's
 *      worst case against `--max-cost-usd`, and expects the calibrated
 *      7-criterion JSON payload back from each.
 *   4. Validates the payload structurally
 *      (`parseScoringPayload()`) — the score for every criterion is
 *      an integer in [1, 5], `total` equals the sum, `provider` is
 *      one of {mock, anthropic}.
 *   5. Caches the parsed payload under
 *      `benchmarks/.scoring-cache/{slug}-{mode}.json`. Cache TTL:
 *      24 hours by default.
 *   6. Writes each new live judgment to `benchmarks/judgments/`, to be
 *      committed; `benchmarks/results.ts` publishes them in RESULTS.md.
 *
 * Flags:
 *   default          — score the live briefings that exist.
 *   --mock-only      — refused: mock text is fixture output.
 *   --live-only      — score live only; error if no live outputs.
 *   --refresh <slug> — ignore the cache for this slug.
 *   --max-cost-usd <n> — required for a paid run: the batch is sent
 *                      only if its worst case fits.
 *   --dry-run        — enumerate briefings, print what WOULD be
 *                      scored and the worst case, do NOT call the API.
 *   --root <path>    — override the repo root (used by tests).
 *
 * ANTHROPIC_API_KEY is required for non-dry runs. When absent, the
 * script emits a structured error naming the missing env var and
 * pointing at docs/benchmarking-methodology.md.
 *
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { parseUsd } from "../src/cli/run-args.ts";
import type { FetchLike } from "../src/llm/anthropic-provider.ts";
import { DEFAULT_PRICE_TABLE } from "../src/llm/pricing.ts";
import { batchWorstCaseUsd, clearPendingBatch, type JudgeRequest, runJudgeBatch } from "./judge-batch.ts";
import { completedLiveRuns } from "./provenance.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScoringMode = "mock" | "live";

/**
 * The judge. Every pipeline stage runs on Claude Opus 5.5 or Sonnet 5.5, so
 * the judge is a third Claude model: no stage's output is scored by the
 * model that wrote it. It is still the same family, so a shared bias can go
 * unseen; the human review in `docs/live-proof-protocol.md` measures it.
 */
export const JUDGE_MODEL = "claude-opus-5";

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
  /** USD the judge's batch may reserve; a paid run without it is refused. */
  maxCostUsd?: number | null;
  /** The Batches API transport and the wait between polls; tests inject them. */
  fetchFn?: FetchLike;
  sleepFn?: (ms: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

/**
 * Mock briefings replay hand-written fixtures chosen by format, not by
 * question, so a score on them grades the fixtures (standards rule 3).
 */
const MOCK_REFUSAL =
  "mock briefings are not scored: their text is fixture output, so a score measures nothing. Score live briefings only.";

export function parseScoreArgs(argv: readonly string[]): ScoreAllOptions {
  let mockOnly = false;
  let liveOnly = false;
  let refresh: string | null = null;
  let dryRun = false;
  let maxCostUsd: number | null = null;
  let root = resolve(import.meta.dir, "..");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--mock-only") throw new Error(MOCK_REFUSAL);
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
    } else if (a === "--max-cost-usd" || a.startsWith("--max-cost-usd=")) {
      const value = a === "--max-cost-usd" ? argv[++i] : a.slice("--max-cost-usd=".length);
      const usd = parseUsd(value);
      if (usd === undefined) throw new Error("--max-cost-usd expects a positive amount in USD");
      maxCostUsd = usd;
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
    maxCostUsd,
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
      const questionDir = join(parent, slug);
      // Skip stray files at the top level (e.g. README.md, .gitkeep).
      if (!statSync(questionDir).isDirectory()) continue;
      // A live question keeps every completed run; the latest is the one
      // scored, so a question is judged once.
      const dir = mode === "live" ? completedLiveRuns(questionDir).at(-1) : questionDir;
      if (dir === undefined) continue;
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
  // Replacer functions: a string replacement would expand `$&`, `$'` and
  // `` $` `` found in the briefing, which is model output.
  return template
    .replace("{briefing_id}", () => meta.id)
    .replace("{provider}", () => (ref.mode === "mock" ? "mock" : "anthropic"))
    .replace("{format_id}", () => meta.format)
    .replace("{question}", () => meta.question)
    // A closing tag inside the briefing would end the delimited block early.
    .replace("{briefing_markdown}", () => briefingMarkdown.replace(/<\/\s*briefing\s*>/gi, "<\\/briefing>"));
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

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * A live question keeps every completed run, so its cached score is keyed by
 * the run it scored: a later run is never given the earlier run's score.
 */
export function cacheKey(ref: BriefingRef): string {
  return ref.mode === "live" ? `${ref.slug}-${basename(ref.dir)}` : ref.slug;
}

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

/**
 * A live judgment, committed: the cache is local and expires, but a score
 * published in RESULTS.md must come from a file in the repository
 * (`benchmarks/results.ts`). Named as the cache names it, by run.
 */
export function writeJudgment(root: string, key: string, payload: ScoringPayload): string {
  const dir = join(root, "benchmarks", "judgments");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${key}-live.json`);
  writeFileSync(path, `${JSON.stringify({ judge_model: JUDGE_MODEL, judged_at: new Date().toISOString(), payload }, null, 2)}\n`);
  return path;
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

export interface ScoreAllReport {
  scored: number;
  from_cache: number;
  errors: number;
  /** The judgments written under `benchmarks/judgments/`, one per newly scored briefing. */
  judgments_written: string[];
  scorings: ScoringPayload[];
  /** The batch's worst case, reserved against the cap; 0 when nothing was sent. */
  reserved_usd: number;
  /** What the batch's usage costs at batch prices. */
  spent_usd: number;
}

/** Polls a batch once a minute for up to 25 hours: batches expire after 24. */
const POLL_MS = 60_000;
const MAX_POLLS = 25 * 60;

function batchState(root: string): string {
  const dir = join(root, "benchmarks", ".scoring-cache");
  mkdirSync(dir, { recursive: true });
  return join(dir, "batch-pending.json");
}

/** The judge's prompt for one briefing, keyed by the batch's custom id. */
function judgeRequest(template: string, ref: BriefingRef): JudgeRequest {
  const metaRaw = JSON.parse(readFileSync(ref.metadata_path, "utf-8"));
  const meta: BriefingMetadata = {
    id: String(metaRaw.id ?? ref.slug),
    question: String(metaRaw.question ?? "(unknown question)"),
    format: String(metaRaw.format ?? "(unknown format)"),
    mode: ref.mode,
  };
  const briefingMarkdown = readFileSync(ref.brief_md_path, "utf-8");
  return {
    custom_id: `${ref.mode}-${ref.slug}`,
    prompt: interpolateScoringPrompt(template, ref, meta, briefingMarkdown),
  };
}

export async function scoreAll(opts: ScoreAllOptions): Promise<ScoreAllReport> {
  const templatePath = join(opts.root, "benchmarks", "scoring-prompt.txt");
  if (!existsSync(templatePath)) {
    throw new Error(
      `scoring prompt template missing at ${templatePath}. See docs/benchmarking-methodology.md.`
    );
  }
  const template = readFileSync(templatePath, "utf-8");

  if (opts.mockOnly) throw new Error(MOCK_REFUSAL);
  const refs = enumerateBriefings(opts.root, { mockOnly: false, liveOnly: true });

  if (opts.liveOnly && refs.filter((r) => r.mode === "live").length === 0) {
    throw new Error(
      "--live-only: no live briefings under benchmarks/outputs/live/. Run `bun run bench:live` first."
    );
  }

  if (opts.dryRun) {
    process.stderr.write(
      `→ dry-run: would score ${refs.length} briefing(s) using ${JUDGE_MODEL}\n`
    );
    for (const r of refs) {
      process.stderr.write(`  · [${r.mode}] ${r.slug} → ${r.brief_md_path}\n`);
    }
    const worst = batchWorstCaseUsd(
      refs.map((r) => judgeRequest(template, r)),
      JUDGE_MODEL,
      DEFAULT_PRICE_TABLE
    );
    process.stderr.write(
      `  batch worst case: $${worst.toFixed(4)}, cached briefings included (a --max-cost-usd at least this is never refused)\n`
    );
    process.stderr.write(
      `(no API call issued; --dry-run does not require ANTHROPIC_API_KEY)\n`
    );
    return {
      scored: 0,
      from_cache: 0,
      errors: 0,
      judgments_written: [],
      scorings: [],
      reserved_usd: 0,
      spent_usd: 0,
    };
  }

  const capUsd = opts.maxCostUsd ?? null;
  if (capUsd === null) {
    throw new Error("a paid scoring run needs --max-cost-usd: run --dry-run first for the batch's worst case");
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

  const apiKey = process.env["ANTHROPIC_API_KEY"] as string;
  const scorings: ScoringPayload[] = [];
  const judgmentsWritten: string[] = [];
  let scored = 0;
  let fromCache = 0;
  let errors = 0;

  const toSend: { ref: BriefingRef; request: JudgeRequest }[] = [];
  for (const ref of refs) {
    const shouldRefresh = opts.refresh !== null && opts.refresh === ref.slug;
    if (!shouldRefresh) {
      const cached = readCache(opts.root, cacheKey(ref), ref.mode, opts.cacheTtlMs);
      if (cached !== null) {
        scorings.push(cached);
        fromCache += 1;
        process.stderr.write(`  ✓ [${ref.mode}] ${ref.slug} (cached, score=${cached.total}/35)\n`);
        continue;
      }
    }
    toSend.push({ ref, request: judgeRequest(template, ref) });
  }

  let reservedUsd = 0;
  let spentUsd = 0;
  if (toSend.length > 0) {
    const statePath = batchState(opts.root);
    const run = await runJudgeBatch(
      toSend.map((t) => t.request),
      {
        model: JUDGE_MODEL,
        apiKey,
        capUsd,
        table: DEFAULT_PRICE_TABLE,
        statePath,
        fetchFn: opts.fetchFn ?? fetch,
        sleepFn: opts.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
        pollMs: POLL_MS,
        maxPolls: MAX_POLLS,
      }
    );
    reservedUsd = run.reserved_usd;
    spentUsd = run.spent_usd;
    toSend.forEach(({ ref }, i) => {
      const outcome = run.outcomes[i];
      try {
        if (outcome === undefined || outcome.text === null) throw new Error(outcome?.error ?? "no outcome");
        const parsed = parseScoringPayload(JSON.parse(extractJsonBody(outcome.text)));
        scorings.push(parsed);
        writeCache(opts.root, cacheKey(ref), ref.mode, parsed);
        judgmentsWritten.push(writeJudgment(opts.root, cacheKey(ref), parsed));
        scored += 1;
        process.stderr.write(`  ✓ [${ref.mode}] ${ref.slug} (score=${parsed.total}/35)\n`);
      } catch (err) {
        // One unusable answer fails its briefing only; it is counted and named.
        errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`  ✗ [${ref.mode}] ${ref.slug} — ${message}\n`);
      }
    });
    // Every answer is now cached or counted as an error: nothing is left to resume.
    clearPendingBatch(statePath);
    process.stderr.write(
      `  batch ${run.batch_id}: $${spentUsd.toFixed(4)} spent, $${reservedUsd.toFixed(4)} reserved, cap $${capUsd.toFixed(2)}\n`
    );
    if (spentUsd > capUsd) {
      // The run's exit status must show it, not only a line on stderr.
      errors += 1;
      process.stderr.write("  ✗ spend passed the cap: a prompt tokenized below the floor's characters per token\n");
    }
  }

  return {
    scored,
    from_cache: fromCache,
    errors,
    judgments_written: judgmentsWritten,
    scorings,
    reserved_usd: reservedUsd,
    spent_usd: spentUsd,
  };
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
  for (const path of report.judgments_written) process.stderr.write(`   wrote ${path}\n`);
  if (report.judgments_written.length > 0) process.stderr.write("   commit them, then: bun run results\n");
  process.exit(report.errors === 0 ? 0 : 1);
}
