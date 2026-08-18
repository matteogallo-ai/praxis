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
 *   default          — mock always; live only if ANTHROPIC_API_KEY is set.
 *   --mock-only      — mock only, ignore ANTHROPIC_API_KEY.
 *   --live-only      — live only; error if ANTHROPIC_API_KEY missing.
 *   --dry-run        — parse+select without spawning the pipeline
 *                      (used by the test suite).
 *   --root <path>    — override the repo root (used by the test suite).
 *
 * Failure model: a single benchmark failing does not abort the run
 * — the failure is recorded, the runner continues, and the exit
 * code is 1 if any benchmark failed.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseYaml } from "@promptlang/yaml-parser";

import { FormatRegistry } from "../src/registry/registry.ts";
import { Orchestrator } from "../src/orchestrator/orchestrator.ts";
import { MockLLMProvider } from "../src/llm/mock-provider.ts";
import { AnthropicLLMProvider } from "../src/llm/anthropic-provider.ts";
import type { LLMProvider } from "../src/llm/provider.ts";
import { render as dispatchRender } from "../src/renderers/index.ts";
import type { BriefWithCritiqueAndRerunResult } from "../src/orchestrator/orchestrator.ts";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

export interface RunAllOptions {
  mockOnly: boolean;
  liveOnly: boolean;
  dryRun: boolean;
  root: string;
}

export function parseRunAllArgs(argv: readonly string[]): RunAllOptions {
  let mockOnly = false;
  let liveOnly = false;
  let dryRun = false;
  let root = resolve(import.meta.dir, "..");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--mock-only") mockOnly = true;
    else if (a === "--live-only") liveOnly = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--root") {
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
  return { mockOnly, liveOnly, dryRun, root };
}

// ---------------------------------------------------------------------------
// Benchmark manifest
// ---------------------------------------------------------------------------

export interface BenchmarkEntry {
  id: string;
  question: string;
  format: string;
  tags: string[];
  intent: string;
}

export interface BenchmarkManifest {
  version: number;
  benchmarks: BenchmarkEntry[];
}

export function loadManifest(path: string): BenchmarkManifest {
  const raw = readFileSync(path, "utf-8");
  const parsed = parseYaml(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`benchmarks manifest at ${path} must be a mapping`);
  }
  const version = (parsed as { version: unknown }).version;
  if (typeof version !== "number") {
    throw new Error(`benchmarks manifest missing numeric 'version' field`);
  }
  const benchmarks = (parsed as { benchmarks: unknown }).benchmarks;
  if (!Array.isArray(benchmarks)) {
    throw new Error(`benchmarks manifest 'benchmarks' must be a list`);
  }
  const validated: BenchmarkEntry[] = [];
  for (const [i, b] of benchmarks.entries()) {
    if (b === null || typeof b !== "object" || Array.isArray(b)) {
      throw new Error(`benchmarks[${i}] must be a mapping`);
    }
    const entry = b as Record<string, unknown>;
    validated.push({
      id: requireString(entry, "id", i),
      question: requireString(entry, "question", i),
      format: requireString(entry, "format", i),
      tags: requireStringList(entry, "tags", i),
      intent: requireString(entry, "intent", i),
    });
  }
  return { version, benchmarks: validated };
}

function requireString(
  o: Record<string, unknown>,
  key: string,
  index: number
): string {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(
      `benchmarks[${index}]: '${key}' must be a non-empty string`
    );
  }
  return v;
}

function requireStringList(
  o: Record<string, unknown>,
  key: string,
  index: number
): string[] {
  const v = o[key];
  if (!Array.isArray(v)) {
    throw new Error(`benchmarks[${index}]: '${key}' must be a list`);
  }
  for (const [j, e] of v.entries()) {
    if (typeof e !== "string" || e.length === 0) {
      throw new Error(
        `benchmarks[${index}].${key}[${j}] must be a non-empty string`
      );
    }
  }
  return v as string[];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

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

  const modes: readonly ("mock" | "live")[] = decideModes(opts);
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

    const llm = makeProvider(mode, opts.root);
    const registry = new FormatRegistry();
    registry.loadDirectory(join(opts.root, "formats"));
    const orchestrator = new Orchestrator(registry, llm);

    for (const b of manifest.benchmarks) {
      const outDir = join(opts.root, "benchmarks", "outputs", mode, b.id);
      const started = Date.now();
      try {
        const format = registry.get(b.format);
        mkdirSync(outDir, { recursive: true });

        const result = await orchestrator.briefWithCritiqueAndRerun(
          b.question,
          b.format
        );

        // Render every target declared in the format's output_targets[]
        // and skip the ones it does not declare. Records the produced
        // artefacts in metadata so downstream scoring can be format-aware.
        const artefacts: Record<string, number> = {};
        const targets = format.output_targets as readonly string[];
        const renderOpts = {
          include_toc: true,
          include_appendices: true,
          include_critique: true,
          include_sourcing_report: true,
        } as const;

        if (targets.includes("md")) {
          const md = await dispatchRender(result, "md-enhanced", format, renderOpts);
          writeFileSync(join(outDir, "brief.md"), md);
          artefacts["brief.md"] = md.length;
        }
        if (targets.includes("pdf")) {
          const pdf = await dispatchRender(result, "pdf", format, renderOpts);
          writeFileSync(join(outDir, "brief.pdf"), pdf);
          artefacts["brief.pdf"] = pdf.length;
        }
        if (targets.includes("docx")) {
          const docx = await dispatchRender(result, "docx", format, renderOpts);
          writeFileSync(join(outDir, "brief.docx"), docx);
          artefacts["brief.docx"] = docx.length;
        }

        const meta = {
          ...buildMetadata(b, mode, result, Date.now() - started),
          artefacts,
        };
        const metadataPath = join(outDir, "metadata.json");
        writeFileSync(metadataPath, JSON.stringify(meta, null, 2) + "\n");

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
  return hasKey ? ["mock", "live"] : ["mock"];
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

function buildMetadata(
  b: BenchmarkEntry,
  mode: "mock" | "live",
  result: BriefWithCritiqueAndRerunResult,
  duration_ms: number
): Record<string, unknown> {
  return {
    id: b.id,
    question: b.question,
    format: b.format,
    tags: b.tags,
    mode,
    duration_ms,
    generated_at: result.generated_at,
    provider_name: result.provider_name,
    synthesis: {
      total_word_count: result.synthesis.total_word_count,
      target_words: result.synthesis.format_conformance.target_words,
      deviation_pct: result.synthesis.format_conformance.deviation_pct,
      sections_over_length:
        result.synthesis.format_conformance.sections_over_length.length,
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
    },
    sourcing: {
      total_items: result.sourcing_report.total_items,
      counts: result.sourcing_report.counts,
      edited_after_critique:
        result.sourcing_report.edited_after_critique === true,
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
