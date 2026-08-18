/**
 * `praxis brief "<question>" --format <id> [flags]` — CLI entry point.
 *
 * v0.6 modes:
 *   default                 Scoping only.
 *   --with-research         Scoping → Research.
 *   --with-stakeholders     Scoping → Research → Stakeholder Mapping.
 *                           Implies --with-research; a note is
 *                           emitted to stdout if used alone.
 *   --with-risks            Scoping → Research → Stakeholders → Risks.
 *                           Implies --with-stakeholders (and therefore
 *                           --with-research); notes emitted to stdout
 *                           if used alone.
 *   --sourcing-report       Prints ONLY the aggregated cross-agent
 *                           sourcing report (useful for audit).
 *                           Implies --with-risks.
 *   --full                  Runs the full six-agent pipeline
 *                           (Scoping → Research → Stakeholders → Risks
 *                           → Options → Synthesis) via
 *                           `Orchestrator.brief()` and prints the
 *                           assembled Markdown briefing. Combines
 *                           with:
 *     --output <path>       Writes the Markdown to `path` instead of
 *                           stdout. Paths must be relative or
 *                           absolute and readable — Praxis writes
 *                           anywhere the process can.
 *     --json                Prints the full `BriefResult` as JSON
 *                           (for audit / downstream tooling).
 *     --with-sourcing-report  Appends the detailed sourcing report
 *                             beneath the briefing.
 *
 * Providers:
 *   --provider mock       (default) reads pre-scripted fixtures under
 *                         `tests/fixtures/mock-llm/`.
 *   --provider anthropic  live provider. Requires `ANTHROPIC_API_KEY`
 *                         in the environment. Enables tool-using
 *                         agents against the real web_search tool.
 */

import { FormatRegistry } from "../../registry/registry.ts";
import { Orchestrator } from "../../orchestrator/orchestrator.ts";
import { MockLLMProvider } from "../../llm/mock-provider.ts";
import { AnthropicLLMProvider } from "../../llm/anthropic-provider.ts";
import {
  ProviderNotSupportedError,
  AnthropicAuthenticationError,
} from "../../llm/errors.ts";
import { PraxisError } from "../../registry/errors.ts";
import {
  c,
  errorWithContext,
  progress,
  renderCritiqueInline,
  renderFullBrief,
  renderResearchResult,
  renderRisks,
  renderScopingResult,
  renderSourcingReport,
  renderStakeholders,
} from "../output.ts";
import {
  AUTO_FORMAT_IDS,
  detectFormatFromQuestion,
} from "../format-auto.ts";
import { FormatNotFoundError } from "../../registry/errors.ts";
import { UnsupportedRenderTargetError } from "../../renderers/errors.ts";
import { writeFileSync } from "node:fs";
import type { LLMProvider } from "../../llm/provider.ts";
import type {
  AdversarialCritiqueResult,
  ScopingResult,
  ResearchResult,
  StakeholderMapResult,
  RiskAnalysisResult,
} from "../../agents/types.ts";
import type { SourcingReport } from "../../sourcing/types.ts";
import { render as dispatchRender } from "../../renderers/index.ts";
import { RENDER_THEMES, type RenderOptions, type RenderTheme } from "../../renderers/types.ts";

export interface BriefCommandOptions {
  question: string;
  formatId: string;
  provider: string;
  json: boolean;
  withResearch: boolean;
  withStakeholders: boolean;
  withRisks: boolean;
  sourcingReport: boolean;
  full: boolean;
  outputPath: string | null;
  critique: boolean;
  /** v0.8 — enables the editorial re-run loop (implies --critique). */
  withRerun: boolean;
  renderTarget: string | null;
  theme: string | null;
  includeToc: boolean;
  includeAppendices: boolean;
  formatsDir: string;
  fixturesDir: string;
}

export interface ParsedBriefArgs {
  question: string;
  formatId: string;
  provider: string;
  json: boolean;
  withResearch: boolean;
  withStakeholders: boolean;
  withRisks: boolean;
  sourcingReport: boolean;
  full: boolean;
  outputPath: string | null;
  critique: boolean;
  withRerun: boolean;
  renderTarget: string | null;
  theme: string | null;
  includeToc: boolean;
  includeAppendices: boolean;
  error?: string;
}

/**
 * Parses the `brief` argument tail: exactly one positional (the
 * question) plus `--format`, optional `--provider`, `--json`,
 * `--with-research`, `--with-stakeholders`.
 */
export function parseBriefArgs(args: readonly string[]): ParsedBriefArgs {
  const positional: string[] = [];
  let formatId: string | null = null;
  let provider = "mock";
  let json = false;
  let withResearch = false;
  let withStakeholders = false;
  let withRisks = false;
  let sourcingReport = false;
  let full = false;
  let outputPath: string | null = null;
  let critique = false;
  let withRerun = false;
  let renderTarget: string | null = null;
  let theme: string | null = null;
  let includeToc = false;
  let includeAppendices = false;

  const errorReturn = (error: string): ParsedBriefArgs => ({
    question: "",
    formatId: "",
    provider,
    json,
    withResearch,
    withStakeholders,
    withRisks,
    sourcingReport,
    full,
    outputPath,
    critique,
    withRerun,
    renderTarget,
    theme,
    includeToc,
    includeAppendices,
    error,
  });

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--format") {
      const next = args[i + 1];
      if (next === undefined) {
        return errorReturn(
          "--format expects an id (e.g. --format executive-pre-read)"
        );
      }
      formatId = next;
      i++;
    } else if (a.startsWith("--format=")) {
      formatId = a.slice("--format=".length);
    } else if (a === "--provider") {
      const next = args[i + 1];
      if (next === undefined) {
        return errorReturn("--provider expects a name (e.g. --provider mock)");
      }
      provider = next;
      i++;
    } else if (a.startsWith("--provider=")) {
      provider = a.slice("--provider=".length);
    } else if (a === "--output") {
      const next = args[i + 1];
      if (next === undefined) {
        return errorReturn("--output expects a file path");
      }
      outputPath = next;
      i++;
    } else if (a.startsWith("--output=")) {
      outputPath = a.slice("--output=".length);
    } else if (a === "--json") {
      json = true;
    } else if (a === "--with-research") {
      withResearch = true;
    } else if (a === "--with-stakeholders") {
      withStakeholders = true;
    } else if (a === "--with-risks") {
      withRisks = true;
    } else if (a === "--sourcing-report") {
      sourcingReport = true;
    } else if (a === "--full") {
      full = true;
    } else if (a === "--with-sourcing-report") {
      // v0.6 alias — `--with-sourcing-report` appends the report to a
      // `--full` briefing (as opposed to `--sourcing-report` which
      // shows ONLY the report and implies `--with-risks`).
      sourcingReport = true;
    } else if (a === "--critique") {
      critique = true;
    } else if (a === "--with-rerun") {
      withRerun = true;
      // --with-rerun implies --critique (the rerun consumes the critique output).
      critique = true;
    } else if (a === "--render") {
      const next = args[i + 1];
      if (next === undefined) {
        return errorReturn(
          "--render expects a target (md-enhanced | docx | pdf)"
        );
      }
      renderTarget = next;
      i++;
    } else if (a.startsWith("--render=")) {
      renderTarget = a.slice("--render=".length);
    } else if (a === "--theme") {
      const next = args[i + 1];
      if (next === undefined) {
        return errorReturn(
          "--theme expects a name (professional | government | consulting)"
        );
      }
      theme = next;
      i++;
    } else if (a.startsWith("--theme=")) {
      theme = a.slice("--theme=".length);
    } else if (a === "--include-toc") {
      includeToc = true;
    } else if (a === "--include-appendices") {
      includeAppendices = true;
    } else {
      positional.push(a);
    }
  }

  if (positional.length === 0) {
    return errorReturn(
      "missing question. Usage: praxis brief \"<question>\" --format <id>"
    );
  }
  if (positional.length > 1) {
    return errorReturn(
      "expected exactly one question. Wrap multi-word questions in quotes."
    );
  }
  if (formatId === null) {
    return {
      question: positional[0]!,
      formatId: "",
      provider,
      json,
      withResearch,
      withStakeholders,
      withRisks,
      sourcingReport,
      full,
      outputPath,
      critique,
      withRerun,
      renderTarget,
      theme,
      includeToc,
      includeAppendices,
      error:
        "--format is required. Usage: praxis brief \"<question>\" --format <id>",
    };
  }
  if (renderTarget !== null && !full) {
    return {
      question: positional[0]!,
      formatId,
      provider,
      json,
      withResearch,
      withStakeholders,
      withRisks,
      sourcingReport,
      full,
      outputPath,
      critique,
      withRerun,
      renderTarget,
      theme,
      includeToc,
      includeAppendices,
      error: "--render requires --full.",
    };
  }
  if (outputPath !== null && !full) {
    return {
      question: positional[0]!,
      formatId,
      provider,
      json,
      withResearch,
      withStakeholders,
      withRisks,
      sourcingReport,
      full,
      outputPath,
      critique,
      withRerun,
      renderTarget,
      theme,
      includeToc,
      includeAppendices,
      error:
        "--output requires --full (the option only applies to the full briefing).",
    };
  }
  if (renderTarget !== null && outputPath === null) {
    return {
      question: positional[0]!,
      formatId,
      provider,
      json,
      withResearch,
      withStakeholders,
      withRisks,
      sourcingReport,
      full,
      outputPath,
      critique,
      withRerun,
      renderTarget,
      theme,
      includeToc,
      includeAppendices,
      error:
        "--render requires --output <path>. Binary formats (pdf, docx) cannot be piped to stdout.",
    };
  }
  if (withRerun && !full) {
    return {
      question: positional[0]!,
      formatId,
      provider,
      json,
      withResearch,
      withStakeholders,
      withRisks,
      sourcingReport,
      full,
      outputPath,
      critique,
      withRerun,
      renderTarget,
      theme,
      includeToc,
      includeAppendices,
      error:
        "--with-rerun requires --full (the editorial re-run loop only applies to the full briefing).",
    };
  }

  return {
    question: positional[0]!,
    formatId,
    provider,
    json,
    withResearch,
    withStakeholders,
    withRisks,
    sourcingReport,
    full,
    outputPath,
    critique,
    withRerun,
    renderTarget,
    theme,
    includeToc,
    includeAppendices,
  };
}

export async function briefCommand(opts: BriefCommandOptions): Promise<number> {
  const llm = selectProvider(opts.provider, opts.fixturesDir);
  const registry = new FormatRegistry();
  registry.loadDirectory(opts.formatsDir);
  const orchestrator = new Orchestrator(registry, llm);

  progress("loaded formats", `${AUTO_FORMAT_IDS.length} shipped, provider=${opts.provider}`);

  if (opts.full) {
    // Run brief() OR briefWithCritique() OR briefWithCritiqueAndRerun().
    // --with-rerun implies --critique (parser enforces).
    progress(
      opts.withRerun
        ? "running full pipeline with critique + rerun"
        : opts.critique
          ? "running full pipeline with critique"
          : "running full pipeline",
      `format=${opts.formatId}`
    );
    const result = opts.withRerun
      ? await orchestrator.briefWithCritiqueAndRerun(opts.question, opts.formatId)
      : opts.critique
        ? await orchestrator.briefWithCritique(opts.question, opts.formatId)
        : await orchestrator.brief(opts.question, opts.formatId);
    progress("pipeline complete", `${result.synthesis.total_word_count} words`);

    // Surface a one-line rerun note to stderr so operators know the
    // editorial re-run loop fired without having to inspect the JSON.
    if (opts.withRerun && hasRerunMetadata(result) && result.rerun_performed) {
      const meta = result.rerun_metadata;
      const changed = meta.re_synthesis_deviations.length;
      const critIds = meta.critiques_addressed.join(", ");
      process.stderr.write(
        `${c.dim("rerun:")} synthesis rewritten to address ${critIds} — ` +
          `${changed} section(s) changed substantially.\n`
      );
    } else if (opts.withRerun && hasRerunMetadata(result) && !result.rerun_performed) {
      process.stderr.write(
        `${c.dim("rerun:")} adversarial critique did not require a rerun.\n`
      );
    }

    // --render <target> — dispatch to the renderer, write binary/text
    // to --output.
    if (opts.renderTarget !== null) {
      const format = registry.get(opts.formatId);
      const renderOpts: RenderOptions = {
        include_sourcing_report: opts.sourcingReport,
        include_critique: opts.critique,
        include_toc: opts.includeToc,
        include_appendices: opts.includeAppendices,
      };
      const themeArg = opts.theme;
      if (themeArg !== null) {
        if (!(RENDER_THEMES as readonly string[]).includes(themeArg)) {
          throw new PraxisError(
            `--theme '${themeArg}' is not one of: ${RENDER_THEMES.join(", ")}`
          );
        }
        renderOpts.theme = themeArg as RenderTheme;
      }
      const buf = await dispatchRender(result, opts.renderTarget, format, renderOpts);
      // opts.outputPath is guaranteed non-null (parser enforces it).
      writeFileSync(opts.outputPath!, buf);
      process.stderr.write(
        `${c.dim("wrote")} ${opts.outputPath} ${c.dim(`(${buf.length} bytes, ${opts.renderTarget})`)}\n`
      );
      return 0;
    }

    // No --render: plain Markdown / JSON stdout output (v0.6 behaviour).
    if (opts.json) {
      const payload = JSON.stringify(result, null, 2) + "\n";
      writeOrEmit(payload, opts.outputPath);
      return 0;
    }
    let out = renderFullBrief(result);
    if (opts.sourcingReport) {
      out += "\n---\n\n";
      out += "# Sourcing Report\n\n";
      out += renderSourcingReportMarkdown(result.sourcing_report);
    }
    writeOrEmit(out, opts.outputPath);
    // Additionally print the inline critique: to stdout if writing
    // the brief to a file (stdout is free); to stdout at the end of
    // the Markdown when brief goes to stdout (colour is fine — the
    // reader is a human at that point, not a pipeline).
    if (opts.critique && hasCritiqueField(result)) {
      const critiqueText = renderCritiqueInline(result.adversarial);
      if (opts.outputPath !== null) {
        process.stderr.write(critiqueText);
      } else {
        process.stdout.write(critiqueText);
      }
    }
    return 0;
  }

  // --sourcing-report (alone, without --full) implies --with-risks
  // (the full pipeline is what produces the aggregated report).
  const wantsRisks = opts.withRisks || opts.sourcingReport;

  if (wantsRisks) {
    if (!opts.withStakeholders && !opts.json) {
      process.stdout.write(
        `${c.dim("note:")} --with-risks implies --with-stakeholders (and --with-research); running the full pipeline.\n`
      );
    }
    const result = await orchestrator.assessRisksAfterStakeholders(
      opts.question,
      opts.formatId
    );
    if (opts.sourcingReport && !opts.withRisks && !opts.json) {
      process.stdout.write(
        `${c.dim("note:")} --sourcing-report implies --with-risks; running the full pipeline.\n`
      );
    }
    if (opts.sourcingReport && !opts.withRisks) {
      printSourcingReportOnly(result.sourcing_report, opts.json);
    } else {
      printFullPipelineWithRisks(
        result.scoping,
        result.research,
        result.stakeholders,
        result.risks,
        result.sourcing_report,
        opts.json
      );
    }
    return 0;
  }

  if (opts.withStakeholders) {
    // --with-stakeholders implies --with-research. When used alone, emit
    // a stdout note so users understand what's about to happen.
    if (!opts.withResearch && !opts.json) {
      process.stdout.write(
        `${c.dim("note:")} --with-stakeholders implies --with-research; running the full pipeline.\n`
      );
    }
    const result = await orchestrator.mapStakeholdersAfterResearch(
      opts.question,
      opts.formatId
    );
    printFullPipeline(result.scoping, result.research, result.stakeholders, opts.json);
    return 0;
  }

  if (opts.withResearch) {
    const result = await orchestrator.researchAfterScoping(
      opts.question,
      opts.formatId
    );
    printScopingPlusResearch(result.scoping, result.research, opts.json);
    return 0;
  }

  const scoping = await orchestrator.scope(opts.question, opts.formatId);
  printScopingOnly(scoping, opts.json);
  return 0;
}

function hasCritiqueField(
  v: object
): v is { adversarial: AdversarialCritiqueResult } {
  return "adversarial" in v && (v as { adversarial: unknown }).adversarial !== undefined;
}

function hasRerunMetadata(
  v: object
): v is {
  rerun_performed: boolean;
  rerun_metadata: { critiques_addressed: string[]; re_synthesis_deviations: string[] };
} {
  return "rerun_performed" in v;
}

function selectProvider(name: string, fixturesDir: string): LLMProvider {
  if (name === "mock") {
    return new MockLLMProvider({ fixturesDir });
  }
  if (name === "anthropic") {
    return new AnthropicLLMProvider();
  }
  throw new ProviderNotSupportedError(name);
}

function printScopingOnly(result: ScopingResult, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderScopingResult(result));
  process.stdout.write(
    `\n${c.dim("Run with --full to produce the full six-agent briefing.")}\n`
  );
}

function printScopingPlusResearch(
  scoping: ScopingResult,
  research: ResearchResult,
  json: boolean
): void {
  if (json) {
    process.stdout.write(JSON.stringify({ scoping, research }, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderScopingResult(scoping));
  process.stdout.write(renderResearchResult(research));
  process.stdout.write(
    `\n${c.dim("Run with --with-stakeholders / --with-risks / --full to extend the pipeline.")}\n`
  );
}

function printFullPipeline(
  scoping: ScopingResult,
  research: ResearchResult,
  stakeholders: StakeholderMapResult,
  json: boolean
): void {
  if (json) {
    process.stdout.write(
      JSON.stringify({ scoping, research, stakeholders }, null, 2) + "\n"
    );
    return;
  }
  process.stdout.write(renderScopingResult(scoping));
  process.stdout.write(renderResearchResult(research));
  process.stdout.write(renderStakeholders(stakeholders));
  process.stdout.write(
    `\n${c.dim("Run with --with-risks / --full to extend the pipeline.")}\n`
  );
}

function printFullPipelineWithRisks(
  scoping: ScopingResult,
  research: ResearchResult,
  stakeholders: StakeholderMapResult,
  risks: RiskAnalysisResult,
  sourcing_report: SourcingReport,
  json: boolean
): void {
  if (json) {
    process.stdout.write(
      JSON.stringify(
        { scoping, research, stakeholders, risks, sourcing_report },
        null,
        2
      ) + "\n"
    );
    return;
  }
  process.stdout.write(renderScopingResult(scoping));
  process.stdout.write(renderResearchResult(research));
  process.stdout.write(renderStakeholders(stakeholders));
  process.stdout.write(renderRisks(risks));
  process.stdout.write(renderSourcingReport(sourcing_report));
  process.stdout.write(
    `\n${c.dim("Run with --full to produce the assembled Markdown briefing.")}\n`
  );
}

function printSourcingReportOnly(report: SourcingReport, json: boolean): void {
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return;
  }
  process.stdout.write(renderSourcingReport(report));
}

/**
 * Write `content` to `path` (creating a new file, overwriting if
 * present) OR to stdout when `path` is null. Emits a one-line
 * confirmation to stderr when writing to a file so pipelines don't
 * silently swallow the output location.
 */
function writeOrEmit(content: string, path: string | null): void {
  if (path === null) {
    process.stdout.write(content);
    return;
  }
  writeFileSync(path, content, "utf-8");
  process.stderr.write(`${c.dim("wrote")} ${path} ${c.dim(`(${content.length} bytes)`)}\n`);
}

/**
 * ANSI-free markdown rendering of the sourcing report, used as an
 * appendix under `--full --with-sourcing-report`.
 */
function renderSourcingReportMarkdown(report: SourcingReport): string {
  const parts: string[] = [];
  parts.push(`**Policy:** ${report.policy}  \n`);
  parts.push(`**Total items:** ${report.total_items}  \n`);
  parts.push(
    `**Counts:** ok ${report.counts.ok} · stale ${report.counts.stale} · ` +
      `untrusted ${report.counts.untrusted} · duplicated ${report.counts.duplicated} · ` +
      `missing ${report.counts.missing}\n\n`
  );
  if (report.warnings.length === 0) {
    parts.push("_No warnings — every inspected item passed._\n");
    return parts.join("");
  }
  parts.push("**Warnings:**\n\n");
  for (const w of report.warnings) {
    parts.push(`- ${describeWarningMarkdown(w)}\n`);
  }
  return parts.join("");
}

function describeWarningMarkdown(w: SourcingReport["warnings"][number]): string {
  switch (w.kind) {
    case "missing_source":
      return `[research] finding[${w.finding_index}] SOURCE_MISSING — ${w.searched_for}`;
    case "missing_stakeholder_evidence":
      return `[stakeholder] '${w.stakeholder_name}' (index ${w.stakeholder_index}) SOURCE_MISSING — ${w.searched_for}`;
    case "missing_risk_evidence":
      return `[risk] ${w.risk_id} .${w.evidence_field} SOURCE_MISSING — ${w.searched_for}`;
    case "stale_source":
      return `[${w.agent}] stale source (${w.age_days} days${w.exceeds_max ? "; past max" : ""}): ${w.url}`;
    case "untrusted_domain":
      return `[${w.agent}] untrusted domain: ${w.url} — ${w.reason}`;
    case "duplicate_source":
      return `[${w.agent}] duplicate source: ${w.url} collides with [${w.previous_agent}] ${w.previous_url}`;
  }
}

/**
 * CLI-level dispatch wrapper that funnels PraxisErrors through a single
 * red-marker exit-code-1 path. Kept out of `briefCommand` itself so
 * that programmatic callers (tests, embedded runtimes) can catch the
 * typed error rather than always exit 1.
 */
export async function runBriefCli(
  args: readonly string[],
  ctx: { formatsDir: string; fixturesDir: string }
): Promise<number> {
  const parsed = parseBriefArgs(args);
  if (parsed.error !== undefined) {
    process.stderr.write(`${c.red("✗")} ${parsed.error}\n`);
    return 1;
  }

  // --format auto: resolve to a concrete format id from question keywords.
  let effectiveFormatId = parsed.formatId;
  if (parsed.formatId === "auto") {
    const detected = detectFormatFromQuestion(parsed.question);
    if (detected.kind === "matched") {
      effectiveFormatId = detected.id;
      progress(
        `--format auto → ${detected.id}`,
        `matched: ${detected.matched_keywords.join(", ")}`
      );
    } else if (detected.kind === "ambiguous") {
      const ranked = detected.matches
        .map((m) => `${m.id} [${m.matched_keywords.join(", ")}]`)
        .join(", ");
      process.stderr.write(
        errorWithContext({
          what: "--format auto: ambiguous match",
          cause: `Question matched multiple formats: ${ranked}.`,
          suggestion:
            "Re-run with an explicit --format <id>. See `praxis formats list` for the shipped set.",
          see: "docs/getting-started.md#choosing-a-format",
        })
      );
      return 1;
    } else {
      process.stderr.write(
        errorWithContext({
          what: "--format auto: no keyword match",
          cause:
            "The question did not include any keyword the auto-router recognises.",
          suggestion: `Pick one of: ${AUTO_FORMAT_IDS.join(", ")}. See \`praxis formats list\`.`,
          see: "docs/getting-started.md#choosing-a-format",
        })
      );
      return 1;
    }
  }

  try {
    return await briefCommand({
      question: parsed.question,
      formatId: effectiveFormatId,
      provider: parsed.provider,
      json: parsed.json,
      withResearch: parsed.withResearch,
      withStakeholders: parsed.withStakeholders,
      withRisks: parsed.withRisks,
      sourcingReport: parsed.sourcingReport,
      full: parsed.full,
      outputPath: parsed.outputPath,
      critique: parsed.critique,
      withRerun: parsed.withRerun,
      renderTarget: parsed.renderTarget,
      theme: parsed.theme,
      includeToc: parsed.includeToc,
      includeAppendices: parsed.includeAppendices,
      formatsDir: ctx.formatsDir,
      fixturesDir: ctx.fixturesDir,
    });
  } catch (err) {
    // v0.9: rich context for the most common actionable failures.
    if (err instanceof AnthropicAuthenticationError) {
      process.stderr.write(
        errorWithContext({
          what: err.message,
          cause: "The Anthropic provider needs a valid API key.",
          suggestion:
            "Export ANTHROPIC_API_KEY in your shell, or switch to --provider mock for offline runs.",
          see: "docs/troubleshooting.md#anthropic-authentication",
        })
      );
      return 1;
    }
    if (err instanceof FormatNotFoundError) {
      process.stderr.write(
        errorWithContext({
          what: err.message,
          cause: "The requested format id is not registered.",
          suggestion:
            "Run `praxis formats list` to see the shipped ids, or add a new YAML file under `formats/`.",
          see: "docs/cookbook.md#add-a-new-briefing-format",
        })
      );
      return 1;
    }
    if (err instanceof UnsupportedRenderTargetError) {
      process.stderr.write(
        errorWithContext({
          what: err.message,
          cause:
            "The requested --render target is not one of md-enhanced, docx, pdf, or is not declared in the format's output_targets[].",
          suggestion:
            "Pick a supported target, or add it to the format's `output_targets` list.",
          see: "docs/renderers.md",
        })
      );
      return 1;
    }
    if (err instanceof PraxisError) {
      process.stderr.write(`${c.red("✗")} ${err.message}\n`);
      return 1;
    }
    if (err instanceof Error) {
      process.stderr.write(`${c.red("✗")} ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}
