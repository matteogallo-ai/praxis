#!/usr/bin/env bun
/**
 * benchmarks/run-all.ts — v0.9 benchmark runner.
 *
 * Runs every entry in `benchmarks/questions.yaml` against the
 * chosen provider(s) and writes the artefacts under
 * `benchmarks/outputs/{mock|live}/{id}/`:
 *
 *   brief.md      — rendered enhanced Markdown
 *   brief.pdf     — rendered PDF via pdfkit
 *   brief.docx    — rendered DOCX from-scratch
 *   metadata.json — the run metadata (question, format, timing,
 *                   word-counts, critique summary, rerun status)
 *
 * Modes:
 *   default          — mock always; live only with ANTHROPIC_API_KEY set
 *                      AND --max-cost-usd given, so a key on disk alone
 *                      never spends.
 *   --mock-only      — mock only, ignore ANTHROPIC_API_KEY.
 *   --live-only      — live only; needs ANTHROPIC_API_KEY and
 *                      --max-cost-usd (except with --dry-run).
 *   --max-cost-usd n — per-briefing cap in USD: a request is sent only if
 *                      its worst case fits in what the briefing has left.
 *   --ids a,b        — only these questions (manifest order).
 *   --dry-run        — parse+select without spawning the pipeline
 *                      (used by the test suite).
 *   --split dev|test — only the questions of that half of the frozen
 *                      split (`benchmarks/split.yaml`); refused if stale.
 *   --root <path>    — override the repo root (used by the test suite).
 *
 * Failure model: a single benchmark failing does not abort the run
 * — the failure is recorded, the runner continues, and the exit
 * code is 1 if any benchmark failed.
 */

import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { type BenchmarkEntry, loadManifest } from "./manifest.ts";
import { commitLiveRun, provenance, recordLiveFailure, stageLiveRun } from "./provenance.ts";
import { loadSplit } from "./split.ts";
import { FormatRegistry } from "../src/registry/registry.ts";
import { Orchestrator } from "../src/orchestrator/orchestrator.ts";
import { UsageLedger } from "../src/orchestrator/ledger.ts";
import { parseUsd } from "../src/cli/run-args.ts";
import { MockLLMProvider } from "../src/llm/mock-provider.ts";
import { AnthropicLLMProvider } from "../src/llm/anthropic-provider.ts";
import type { LLMProvider } from "../src/llm/provider.ts";
import {
  markdownEnhancedRenderer,
  pdfRenderer,
  docxRenderer,
} from "../src/renderers/index.ts";
import type { BriefWithCritiqueAndRerunResult } from "../src/orchestrator/orchestrator.ts";
import { FIXTURE_CLOCK } from "../tests/fixtures/clock.ts";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export interface RunAllOptions {
  mockOnly: boolean;
  liveOnly: boolean;
  dryRun: boolean;
  root: string;
  split?: "dev" | "test";
  ids?: string[];
  maxCostUsd?: number;
}

export function parseRunAllArgs(argv: readonly string[]): RunAllOptions {
  let mockOnly = false;
  let liveOnly = false;
  let dryRun = false;
  let root = resolve(import.meta.dir, "..");
  let split: "dev" | "test" | undefined;
  let ids: string[] | undefined;
  let maxCostUsd: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--mock-only") mockOnly = true;
    else if (a === "--live-only") liveOnly = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--split" || a.startsWith("--split=")) {
      const value = a === "--split" ? argv[++i] : a.slice("--split=".length);
      if (value !== "dev" && value !== "test") {
        throw new Error("--split expects dev or test");
      }
      split = value;
    } else if (a === "--ids" || a.startsWith("--ids=")) {
      const value = a === "--ids" ? argv[++i] : a.slice("--ids=".length);
      const list = (value ?? "").split(",");
      if (value === undefined || list.some((id) => id.length === 0)) {
        throw new Error("--ids expects a comma-separated list of question ids");
      }
      ids = list;
    } else if (a === "--max-cost-usd" || a.startsWith("--max-cost-usd=")) {
      const value = a === "--max-cost-usd" ? argv[++i] : a.slice("--max-cost-usd=".length);
      const n = parseUsd(value);
      if (n === undefined) {
        throw new Error("--max-cost-usd expects a positive decimal number of US dollars, e.g. 8 or 7.50");
      }
      maxCostUsd = n;
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
  if (liveOnly && !dryRun && maxCostUsd === undefined) {
    throw new Error("--live-only needs --max-cost-usd <USD per briefing>");
  }
  return {
    mockOnly,
    liveOnly,
    dryRun,
    root,
    ...(split === undefined ? {} : { split }),
    ...(ids === undefined ? {} : { ids }),
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Mock runs use a fixed clock so `bun run bench:mock` rewrites the committed
 * artefacts byte for byte (rule: a rerun leaves `git status` clean). The date
 * is when the fixtures were written (`tests/fixtures/clock.ts`): their sources' `accessed_at` values are
 * classified as fresh against it, whatever the real date. Mock metadata also
 * omits `duration_ms`, which measures the machine, not the pipeline.
 */
const MOCK_CLOCK = new Date(FIXTURE_CLOCK);

export interface BenchmarkOutcome {
  id: string;
  mode: "mock" | "live";
  ok: boolean;
  error?: string;
  duration_ms?: number;
  metadata_path?: string;
}

export interface RunSummary {
  total: number;
  ok: number;
  failed: number;
  outcomes: BenchmarkOutcome[];
}

export async function runAll(opts: RunAllOptions): Promise<RunSummary> {
  const manifestPath = join(opts.root, "benchmarks", "questions.yaml");
  const manifest = loadManifest(manifestPath);
  if (opts.split !== undefined) {
    const ids = new Set(loadSplit(opts.root)[opts.split]);
    manifest.benchmarks = manifest.benchmarks.filter((b) => ids.has(b.id));
  }
  if (opts.ids !== undefined) {
    const known = new Set(manifest.benchmarks.map((b) => b.id));
    const unknown = opts.ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      const where = opts.split === undefined ? "questions.yaml" : `the ${opts.split} split`;
      throw new Error(`--ids: not in ${where}: ${unknown.join(", ")}`);
    }
    const wanted = new Set(opts.ids);
    manifest.benchmarks = manifest.benchmarks.filter((b) => wanted.has(b.id));
  }

  const modes: readonly ("mock" | "live")[] = decideModes(opts);
  const maxCostUsd = opts.maxCostUsd;
  if (modes.includes("live") && !opts.dryRun && !(maxCostUsd !== undefined && Number.isFinite(maxCostUsd) && maxCostUsd > 0)) {
    // The parser refuses this too; runAll is also called directly.
    throw new Error("a live run needs --max-cost-usd, a positive number: no briefing is paid for without a cap");
  }
  process.stderr.write(
    `→ benchmarks: ${manifest.benchmarks.length} entries × ${modes.length} mode(s) [${modes.join(", ")}]\n`
  );

  const outcomes: BenchmarkOutcome[] = [];
  for (const mode of modes) {
    // Dry-run does NOT construct a provider — it just projects
    // manifest × modes into an outcome list. This lets tests exercise
    // --live-only without an API key.
    if (opts.dryRun) {
      for (const b of manifest.benchmarks) {
        const outDir = join(opts.root, "benchmarks", "outputs", mode, b.id);
        outcomes.push({ id: b.id, mode, ok: true, metadata_path: outDir });
      }
      continue;
    }

    // A run of record names the commit it ran from, so it must be that commit.
    const runProvenance = mode === "live" ? provenance(opts.root) : undefined;
    if (runProvenance?.git_dirty) {
      throw new Error("a live run needs a clean working tree: commit or stash tracked changes first");
    }
    const llm = makeProvider(mode, opts.root);
    const registry = new FormatRegistry();
    registry.loadDirectory(join(opts.root, "formats"));
    const orchestrator = new Orchestrator(registry, llm);

    for (const b of manifest.benchmarks) {
      const outDir = join(opts.root, "benchmarks", "outputs", mode, b.id);
      const started = Date.now();
      // Mock usage is simulated from text length, so it is flagged and its
      // durations are left out to keep the artefacts byte-identical.
      const ledger =
        mode === "mock"
          ? new UsageLedger({ simulated: true })
          : liveLedger(maxCostUsd ?? 0);
      let briefingStarted = false;
      // Live renders go to a staged directory, committed once complete.
      let writeDir = outDir;
      try {
        // Validate format exists before spawning the orchestrator so
        // an unknown format surfaces as a clean per-benchmark failure
        // rather than a mid-pipeline throw.
        registry.get(b.format);
        mkdirSync(outDir, { recursive: true });
        if (mode === "live") writeDir = stageLiveRun(outDir, new Date(started));
        briefingStarted = true;
        const result = await orchestrator.briefWithCritiqueAndRerun(
          b.question,
          b.format,
          mode === "mock"
            ? { now: MOCK_CLOCK, onSourcingFailure: "degrade", ledger }
            : { onSourcingFailure: "degrade", ledger }
        );

        // Always render md + pdf + docx regardless of the format's
        // declared output_targets. The benchmark harness needs the
        // full trifecta uniformly: brief.md is the input to
        // benchmarks/score-all.ts (AI-assisted qualitative scoring)
        // and brief.pdf / brief.docx are the human-review artefacts.
        //
        // We call the renderer implementations directly rather than
        // going through the `render()` dispatcher — the dispatcher
        // enforces `format.output_targets[]` because it protects the
        // user-facing CLI surface, but a benchmark run is a harness,
        // not a user artefact, and it disregards that declaration to
        // keep coverage uniform across all formats.
        const artefacts: Record<string, number> = {};
        const renderOpts = {
          include_toc: true,
          include_appendices: true,
          include_critique: true,
          include_sourcing_report: true,
        } as const;

        const md = await markdownEnhancedRenderer.render(result, renderOpts);
        writeFileSync(join(writeDir, "brief.md"), md);
        artefacts["brief.md"] = md.length;

        const pdf = await pdfRenderer.render(result, renderOpts);
        writeFileSync(join(writeDir, "brief.pdf"), pdf);
        artefacts["brief.pdf"] = pdf.length;

        const docx = await docxRenderer.render(result, renderOpts);
        writeFileSync(join(writeDir, "brief.docx"), docx);
        artefacts["brief.docx"] = docx.length;

        const meta = {
          ...buildMetadata(
            b,
            mode,
            result,
            mode === "mock" ? null : Date.now() - started
          ),
          usage: ledger.summary(mode !== "mock"),
          artefacts,
          ...(runProvenance === undefined ? {} : { provenance: runProvenance }),
        };
        writeFileSync(join(writeDir, "metadata.json"), `${JSON.stringify(meta, null, 2)}\n`);
        const runDir = mode === "live" ? commitLiveRun(writeDir, outDir, new Date(started)) : outDir;
        const metadataPath = join(runDir, "metadata.json");

        outcomes.push({
          id: b.id,
          mode,
          ok: true,
          duration_ms: Date.now() - started,
          metadata_path: metadataPath,
        });
        process.stderr.write(
          `  ✓ [${mode}] ${b.id} (${Date.now() - started}ms)\n`
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // A partial render is not a record; the error file below is.
        if (writeDir !== outDir) rmSync(writeDir, { recursive: true, force: true });
        if (mode === "live" && briefingStarted) {
          recordLiveFailure(outDir, new Date(), {
            id: b.id,
            question: b.question,
            format: b.format,
            error: message,
            error_type: err instanceof Error ? err.name : typeof err,
            usage: ledger.summary(true),
            provenance: runProvenance,
          });
        }
        outcomes.push({
          id: b.id,
          mode,
          ok: false,
          error: message,
          duration_ms: Date.now() - started,
        });
        process.stderr.write(`  ✗ [${mode}] ${b.id} — ${message}\n`);
      }
    }
  }

  const summary = summarise(outcomes);
  return summary;
}

function decideModes(opts: RunAllOptions): readonly ("mock" | "live")[] {
  if (opts.mockOnly) return ["mock"];
  if (opts.liveOnly) return ["live"];
  const hasKey =
    typeof process.env["ANTHROPIC_API_KEY"] === "string" &&
    process.env["ANTHROPIC_API_KEY"]!.length > 0;
  return hasKey && opts.maxCostUsd !== undefined ? ["mock", "live"] : ["mock"];
}

/** A live briefing's ledger: real usage, stopped at `maxCostUsd`. */
export function liveLedger(maxCostUsd: number): UsageLedger {
  return new UsageLedger({ maxCostUsd });
}

function makeProvider(mode: "mock" | "live", root: string): LLMProvider {
  if (mode === "mock") {
    return new MockLLMProvider({
      fixturesDir: join(root, "tests", "fixtures", "mock-llm"),
    });
  }
  if (
    typeof process.env["ANTHROPIC_API_KEY"] !== "string" ||
    process.env["ANTHROPIC_API_KEY"]!.length === 0
  ) {
    throw new Error(
      "--live-only requires ANTHROPIC_API_KEY in the environment"
    );
  }
  return new AnthropicLLMProvider();
}

export function buildMetadata(
  b: BenchmarkEntry,
  mode: "mock" | "live",
  result: BriefWithCritiqueAndRerunResult,
  duration_ms: number | null
): Record<string, unknown> {
  return {
    id: b.id,
    question: b.question,
    format: b.format,
    tags: b.tags,
    mode,
    ...(duration_ms === null ? {} : { duration_ms }),
    generated_at: result.generated_at,
    provider_name: result.provider_name,
    synthesis: {
      total_word_count: result.synthesis.total_word_count,
      target_words: result.synthesis.format_conformance.target_words,
      deviation_pct: result.synthesis.format_conformance.deviation_pct,
      sections_over_length:
        result.synthesis.format_conformance.sections_over_length.length,
      sections_over_length_ids: result.synthesis.format_conformance.sections_over_length,
      forbidden_terms_found:
        result.synthesis.format_conformance.forbidden_terms_found.length,
    },
    adversarial: {
      critical_count: result.adversarial.critical_count,
      material_count: result.adversarial.material_count,
      minor_count: result.adversarial.minor_count,
      revised_recommendation_needed:
        result.adversarial.revised_recommendation_needed,
    },
    rerun: {
      performed: result.rerun_performed,
      critiques_addressed_count:
        result.rerun_metadata?.critiques_addressed.length ?? 0,
      re_synthesis_deviations:
        result.rerun_metadata?.re_synthesis_deviations ?? [],
      ...(result.rerun_skipped === undefined ? {} : { skipped: result.rerun_skipped }),
    },
    sourcing: {
      total_items: result.sourcing_report.total_items,
      counts: result.sourcing_report.counts,
      edited_after_critique:
        result.sourcing_report.edited_after_critique === true,
      insufficiently_sourced:
        result.sourcing_report.insufficiently_sourced === true,
      ...(result.sourcing_report.freshness_unknown === undefined
        ? {}
        : { freshness_unknown: result.sourcing_report.freshness_unknown }),
      ...(result.sourcing_report.requester_provided === undefined
        ? {}
        : { requester_provided: result.sourcing_report.requester_provided }),
      ...(result.sourcing_report.untrusted_citations === undefined
        ? {}
        : { untrusted_citations: result.sourcing_report.untrusted_citations }),
      ...(result.sourcing_report.first_party_sources === undefined
        ? {}
        : { first_party_sources: result.sourcing_report.first_party_sources }),
    },
  };
}

function summarise(outcomes: BenchmarkOutcome[]): RunSummary {
  const ok = outcomes.filter((o) => o.ok).length;
  return {
    total: outcomes.length,
    ok,
    failed: outcomes.length - ok,
    outcomes,
  };
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const opts = parseRunAllArgs(process.argv.slice(2));
  const started = Date.now();
  const summary = await runAll(opts);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  process.stderr.write(
    `\n== ${summary.ok}/${summary.total} ok (${summary.failed} failed) — ${elapsed}s ==\n`
  );
  if (!existsSync(join(opts.root, "benchmarks", "outputs"))) {
    process.stderr.write("  (no outputs directory — dry-run?)\n");
  }
  process.exit(summary.failed === 0 ? 0 : 1);
}
