/**
 * Terminal output helpers — raw ANSI, zero dependencies.
 *
 * Colours are automatically disabled when:
 *   - NO_COLOR is set (https://no-color.org/), OR
 *   - stdout is not a TTY (piped, redirected).
 *
 * Test suites can force colour off explicitly by calling `setColorEnabled(false)`.
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const FG_RED = "\x1b[31m";
const FG_GREEN = "\x1b[32m";
const FG_YELLOW = "\x1b[33m";
const FG_BLUE = "\x1b[34m";
const FG_MAGENTA = "\x1b[35m";
const FG_CYAN = "\x1b[36m";

let colorEnabled = detectColor();

function detectColor(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env["NO_COLOR"] !== undefined && process.env["NO_COLOR"] !== "") {
    return false;
  }
  return Boolean(process.stdout?.isTTY);
}

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

function wrap(code: string, s: string): string {
  return colorEnabled ? `${code}${s}${RESET}` : s;
}

export const c = {
  bold: (s: string) => wrap(BOLD, s),
  dim: (s: string) => wrap(DIM, s),
  red: (s: string) => wrap(FG_RED, s),
  green: (s: string) => wrap(FG_GREEN, s),
  yellow: (s: string) => wrap(FG_YELLOW, s),
  blue: (s: string) => wrap(FG_BLUE, s),
  magenta: (s: string) => wrap(FG_MAGENTA, s),
  cyan: (s: string) => wrap(FG_CYAN, s),
};

// ---------------------------------------------------------------------------
// v0.9 — verbosity, symbols, progress, errorWithContext.
// ---------------------------------------------------------------------------

export type Verbosity = "quiet" | "normal" | "verbose";

let verbosity: Verbosity = "normal";

export function setVerbosity(v: Verbosity): void {
  verbosity = v;
}

export function getVerbosity(): Verbosity {
  return verbosity;
}

/**
 * Terminal glyphs used across the CLI. Colour-styled variants are
 * available via `styledSymbols`; the plain names are ASCII-safe
 * fallbacks used by pipes / non-TTY sinks.
 */
export const symbols = {
  success: "✓",
  error: "✗",
  warn: "⚠",
  info: "ℹ",
  bullet: "•",
  arrow: "→",
} as const;

export const styledSymbols = {
  success: () => c.green(symbols.success),
  error: () => c.red(symbols.error),
  warn: () => c.yellow(symbols.warn),
  info: () => c.blue(symbols.info),
  bullet: () => c.dim(symbols.bullet),
  arrow: () => c.dim(symbols.arrow),
};

/**
 * Emit a leveled log line to stderr. The verbosity gate:
 *   quiet   → suppresses info/success/verbose (errors + warnings pass).
 *   normal  → suppresses verbose (everything else passes).
 *   verbose → passes everything.
 */
export function log(
  level: "info" | "success" | "warn" | "error" | "verbose",
  message: string
): void {
  if (level === "verbose" && verbosity !== "verbose") return;
  if ((level === "info" || level === "success") && verbosity === "quiet") return;
  const sym =
    level === "success"
      ? styledSymbols.success()
      : level === "warn"
        ? styledSymbols.warn()
        : level === "error"
          ? styledSymbols.error()
          : level === "info"
            ? styledSymbols.info()
            : c.dim(symbols.arrow);
  process.stderr.write(`${sym} ${message}\n`);
}

/**
 * One-line progress marker to stderr. Suppressed under `--quiet`;
 * dimmed under `--normal` (default); prefixed with a bright arrow
 * under `--verbose`.
 */
export function progress(step: string, detail?: string): void {
  if (verbosity === "quiet") return;
  const arrow = verbosity === "verbose" ? c.cyan(symbols.arrow) : c.dim(symbols.arrow);
  const body = detail !== undefined ? `${step} ${c.dim(`(${detail})`)}` : step;
  process.stderr.write(`${arrow} ${body}\n`);
}

/**
 * Structured error record used by `errorWithContext()`. Every field
 * except `what` is optional; the renderer omits missing lines
 * cleanly so callers can compose partial messages.
 */
export interface ErrorContext {
  what: string;
  cause?: string;
  suggestion?: string;
  see?: string;
}

/**
 * Render a structured error as a compact stderr block:
 *
 *   ✗ <what>
 *     cause:      <cause>
 *     suggestion: <suggestion>
 *     see:        <see>
 *
 * Returned as a string so callers can decide whether to also throw,
 * suppress under --quiet, or funnel through additional formatting.
 */
export function errorWithContext(ctx: ErrorContext): string {
  const lines: string[] = [];
  lines.push(`${styledSymbols.error()} ${c.bold(ctx.what)}`);
  if (ctx.cause !== undefined) {
    lines.push(`  ${c.dim("cause:")}      ${ctx.cause}`);
  }
  if (ctx.suggestion !== undefined) {
    lines.push(`  ${c.dim("suggestion:")} ${ctx.suggestion}`);
  }
  if (ctx.see !== undefined) {
    lines.push(`  ${c.dim("see:")}        ${ctx.see}`);
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Table renderer (fixed-width, monospace, no external dep).
// ---------------------------------------------------------------------------

export interface TableColumn {
  header: string;
  key: string;
  /** Optional min width. The final width is max(min, header.length, longest cell). */
  minWidth?: number;
}

/**
 * Render a fixed-width table. Column widths are computed from the widest
 * value in each column (or `minWidth`, whichever is larger). Header row
 * is bolded when colour is enabled.
 */
export function renderTable(
  columns: readonly TableColumn[],
  rows: readonly { [k: string]: string }[]
): string {
  const widths = columns.map((col) => {
    let w = Math.max(col.minWidth ?? 0, col.header.length);
    for (const row of rows) {
      const cell = row[col.key] ?? "";
      if (cell.length > w) w = cell.length;
    }
    return w;
  });

  const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));

  const headerCells = columns.map((col, i) => c.bold(pad(col.header, widths[i]!)));
  const header = headerCells.join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map((row) =>
      columns.map((col, i) => pad(row[col.key] ?? "", widths[i]!)).join("  ")
    )
    .join("\n");

  return [header, c.dim(separator), body].filter((s) => s.length > 0).join("\n");
}

// ---------------------------------------------------------------------------
// Section rendering for `inspect`.
// ---------------------------------------------------------------------------

export function renderSectionHeader(title: string): string {
  return `\n${c.bold(c.cyan(title))}\n${c.dim("=".repeat(title.length))}`;
}

export function renderKeyValue(key: string, value: string, keyWidth = 20): string {
  const paddedKey = key + " ".repeat(Math.max(0, keyWidth - key.length));
  return `  ${c.dim(paddedKey)}${value}`;
}

export function renderBullet(text: string): string {
  return `  ${c.dim("-")} ${text}`;
}

// ---------------------------------------------------------------------------
// Agent output renderers — used by `praxis brief`.
// ---------------------------------------------------------------------------

import type {
  ScopingResult,
  ResearchResult,
  StakeholderMapResult,
  RiskAnalysisResult,
} from "../agents/types.ts";
import type { SourcingReport } from "../sourcing/types.ts";
import { isSourceMissing } from "../sourcing/types.ts";

export function renderScopingResult(result: ScopingResult): string {
  const parts: string[] = [];
  parts.push(`\n${c.bold(c.cyan("Scoping agent output"))}\n`);
  parts.push(`${c.dim("=".repeat(20))}\n`);
  parts.push(JSON.stringify(result, null, 2) + "\n");
  return parts.join("");
}

export function renderResearchResult(result: ResearchResult): string {
  const parts: string[] = [];
  parts.push(`\n${c.bold(c.cyan("Research agent output"))}\n`);
  parts.push(`${c.dim("=".repeat(21))}\n`);
  parts.push(
    `${c.dim(`Findings: ${result.findings.length}  |  ` +
      `Queries: ${result.search_queries_used.length}  |  ` +
      `Open questions: ${result.open_questions.length}`)}\n\n`
  );

  for (const [i, f] of result.findings.entries()) {
    parts.push(`${c.bold(`[${i + 1}] ${f.claim}`)}\n`);
    parts.push(`    ${c.dim("Evidence:")} ${f.supporting_evidence}\n`);
    if (isSourceMissing(f.source)) {
      parts.push(
        `    ${c.yellow("Source:")} ${c.yellow("[SOURCE MISSING]")} ${c.dim("searched for:")} ${f.source.searched_for}\n`
      );
    } else {
      parts.push(`    ${c.dim("Source:")} ${c.blue(f.source.url)}\n`);
      parts.push(`    ${c.dim("Title:")}  ${f.source.title}\n`);
      parts.push(`    ${c.dim("Excerpt:")} ${truncateForDisplay(f.source.excerpt, 240)}\n`);
    }
    parts.push("\n");
  }

  if (result.open_questions.length > 0) {
    parts.push(`${c.bold("Open questions")}\n`);
    for (const q of result.open_questions) {
      parts.push(`  ${c.dim("-")} ${q}\n`);
    }
    parts.push("\n");
  }

  parts.push(`${c.dim("Search queries used:")}\n`);
  for (const q of result.search_queries_used) {
    parts.push(`  ${c.dim("·")} ${q}\n`);
  }

  return parts.join("");
}

function truncateForDisplay(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

// ---------------------------------------------------------------------------
// Stakeholder Mapping renderer (v0.4).
// ---------------------------------------------------------------------------

/** Cap for stakeholder name column in the compact table (chars). */
const STAKEHOLDER_NAME_MAX = 40;

export function renderStakeholders(result: StakeholderMapResult): string {
  const parts: string[] = [];
  parts.push(`\n${c.bold(c.cyan("Stakeholder mapping output"))}\n`);
  parts.push(`${c.dim("=".repeat(26))}\n`);
  parts.push(
    `${c.dim(
      `Stakeholders: ${result.stakeholders.length}  |  ` +
        `Dynamics: ${result.key_dynamics.length}  |  ` +
        `Blind spots: ${result.blind_spots.length}  |  ` +
        `Coverage confidence: ${result.coverage_confidence}`
    )}\n\n`
  );

  const rows = result.stakeholders.map((s) => ({
    name: truncateForDisplay(s.name, STAKEHOLDER_NAME_MAX),
    category: s.category,
    position: s.position,
    power: s.power,
    priority: s.priority,
  }));
  const table = renderTable(
    [
      { header: "Name", key: "name" },
      { header: "Category", key: "category" },
      { header: "Position", key: "position" },
      { header: "Power", key: "power" },
      { header: "Priority", key: "priority" },
    ],
    rows
  );
  parts.push(table + "\n\n");

  for (const [i, s] of result.stakeholders.entries()) {
    parts.push(`${c.bold(`[${i + 1}] ${s.name}`)}\n`);
    parts.push(`    ${c.dim("Interest:")} ${s.interest}\n`);
    parts.push(`    ${c.dim("Engagement:")} ${s.engagement_notes}\n`);
    if (isSourceMissing(s.position_evidence)) {
      parts.push(
        `    ${c.yellow("Evidence:")} ${c.yellow("[SOURCE MISSING]")} ${c.dim(
          "searched for:"
        )} ${s.position_evidence.searched_for}\n`
      );
    } else {
      parts.push(`    ${c.dim("Evidence:")} ${c.blue(s.position_evidence.url)}\n`);
      parts.push(`    ${c.dim("Title:")}    ${s.position_evidence.title}\n`);
      parts.push(
        `    ${c.dim("Excerpt:")}  ${truncateForDisplay(s.position_evidence.excerpt, 240)}\n`
      );
    }
    parts.push("\n");
  }

  if (result.key_dynamics.length > 0) {
    parts.push(`${c.bold("Key dynamics")}\n`);
    for (const d of result.key_dynamics) {
      parts.push(`  ${c.dim("-")} ${d}\n`);
    }
    parts.push("\n");
  }

  if (result.blind_spots.length > 0) {
    parts.push(`${c.bold("Blind spots")}\n`);
    for (const b of result.blind_spots) {
      parts.push(`  ${c.dim("-")} ${b}\n`);
    }
    parts.push("\n");
  }

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Risk Analysis renderer (v0.5).
// ---------------------------------------------------------------------------

/** Cap for risk-description column in the compact table. */
const RISK_DESC_MAX = 60;

export function renderRisks(result: RiskAnalysisResult): string {
  const parts: string[] = [];
  parts.push(`\n${c.bold(c.cyan("Risk analysis output"))}\n`);
  parts.push(`${c.dim("=".repeat(20))}\n`);
  parts.push(
    `${c.dim(
      `Risks: ${result.risks.length}  |  ` +
        `Overall: ${result.aggregated_risk_score.overall}  |  ` +
        `Top-3: ${result.top_3_priorities.join(", ")}  |  ` +
        `Uncertainties: ${result.unresolved_uncertainties.length}`
    )}\n\n`
  );

  const rows = result.risks.map((r) => ({
    id: r.id,
    category: r.category,
    likelihood: r.likelihood,
    impact: r.impact,
    timeframe: r.timeframe,
    description: truncateForDisplay(r.description, RISK_DESC_MAX),
  }));
  const table = renderTable(
    [
      { header: "ID", key: "id" },
      { header: "Category", key: "category" },
      { header: "Likelihood", key: "likelihood" },
      { header: "Impact", key: "impact" },
      { header: "Timeframe", key: "timeframe" },
      { header: "Description", key: "description" },
    ],
    rows
  );
  parts.push(table + "\n\n");

  parts.push(`${c.bold("Aggregated risk score")}\n`);
  parts.push(`  ${c.dim("Overall:")}   ${result.aggregated_risk_score.overall}\n`);
  for (const [cat, level] of Object.entries(
    result.aggregated_risk_score.by_category
  )) {
    parts.push(`  ${c.dim(`${cat}:`.padEnd(20))}${level}\n`);
  }
  parts.push("\n");

  parts.push(`${c.bold("Top-3 priorities")}\n`);
  for (const id of result.top_3_priorities) {
    const r = result.risks.find((x) => x.id === id);
    const label = r ? `${id} — ${truncateForDisplay(r.description, 80)}` : id;
    parts.push(`  ${c.dim("-")} ${label}\n`);
  }
  parts.push("\n");

  for (const [i, r] of result.risks.entries()) {
    parts.push(`${c.bold(`[${i + 1}] ${r.id} — ${r.description}`)}\n`);
    parts.push(
      `    ${c.dim("Category:")}    ${r.category}  |  ${c.dim("Timeframe:")} ${r.timeframe}\n`
    );
    parts.push(
      `    ${c.dim("Likelihood:")} ${r.likelihood}  |  ${c.dim("Impact:")} ${r.impact}  |  ${c.dim("Residual:")} ${r.residual_risk_after_mitigation}\n`
    );
    parts.push(
      `    ${c.dim("Affects:")}    ${r.affected_stakeholders.join(", ")}\n`
    );
    parts.push(`    ${c.dim("Mitigations:")}\n`);
    for (const m of r.mitigations) parts.push(`      ${c.dim("·")} ${m}\n`);
    if (isSourceMissing(r.likelihood_evidence)) {
      parts.push(
        `    ${c.yellow("Likelihood evidence:")} ${c.yellow("[SOURCE MISSING]")} ${c.dim(
          "searched for:"
        )} ${r.likelihood_evidence.searched_for}\n`
      );
    } else {
      parts.push(
        `    ${c.dim("Likelihood evidence:")} ${c.blue(r.likelihood_evidence.url)}\n`
      );
    }
    if (isSourceMissing(r.impact_evidence)) {
      parts.push(
        `    ${c.yellow("Impact evidence:")}     ${c.yellow("[SOURCE MISSING]")} ${c.dim(
          "searched for:"
        )} ${r.impact_evidence.searched_for}\n`
      );
    } else {
      parts.push(
        `    ${c.dim("Impact evidence:")}     ${c.blue(r.impact_evidence.url)}\n`
      );
    }
    parts.push("\n");
  }

  if (result.unresolved_uncertainties.length > 0) {
    parts.push(`${c.bold("Unresolved uncertainties")}\n`);
    for (const u of result.unresolved_uncertainties) {
      parts.push(`  ${c.dim("-")} ${u}\n`);
    }
    parts.push("\n");
  }

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Sourcing report renderer (v0.5, cross-agent aggregated).
// ---------------------------------------------------------------------------

export function renderSourcingReport(report: SourcingReport): string {
  const parts: string[] = [];
  parts.push(`\n${c.bold(c.cyan("Sourcing report"))}\n`);
  parts.push(`${c.dim("=".repeat(15))}\n`);
  parts.push(
    `${c.dim(
      `Policy: ${report.policy}  |  ` +
        `Total items: ${report.total_items}  |  ` +
        `OK: ${report.counts.ok}  |  ` +
        `Stale: ${report.counts.stale}  |  ` +
        `Untrusted: ${report.counts.untrusted}  |  ` +
        `Duplicated: ${report.counts.duplicated}  |  ` +
        `Missing: ${report.counts.missing}`
    )}\n\n`
  );

  if (report.warnings.length === 0) {
    parts.push(`${c.green("✓")} No warnings — every inspected item passed.\n`);
    return parts.join("");
  }

  parts.push(`${c.bold("Warnings")}\n`);
  for (const w of report.warnings) {
    parts.push(`  ${c.dim("-")} ${describeWarning(w)}\n`);
  }
  return parts.join("");
}

function describeWarning(w: SourcingReport["warnings"][number]): string {
  switch (w.kind) {
    case "missing_source":
      return `[research] finding[${w.finding_index}] SOURCE_MISSING — searched for: ${w.searched_for}`;
    case "missing_stakeholder_evidence":
      return `[stakeholder] '${w.stakeholder_name}' (index ${w.stakeholder_index}) SOURCE_MISSING — searched for: ${w.searched_for}`;
    case "missing_risk_evidence":
      return `[risk] ${w.risk_id} .${w.evidence_field} SOURCE_MISSING — searched for: ${w.searched_for}`;
    case "stale_source":
      return `[${w.agent}] stale source (${w.age_days} days${w.exceeds_max ? "; past max" : ""}): ${w.url}`;
    case "untrusted_domain":
      return `[${w.agent}] untrusted domain: ${w.url} — ${w.reason}`;
    case "duplicate_source":
      return `[${w.agent}] duplicate source: ${w.url} collides with [${w.previous_agent}] ${w.previous_url}`;
  }
}

// ---------------------------------------------------------------------------
// Full briefing renderer (v0.6) — YAML front-matter + Markdown sections.
// ---------------------------------------------------------------------------

import type { BriefResult } from "../orchestrator/orchestrator.ts";

/**
 * Render a `BriefResult` as a self-contained Markdown document with a
 * YAML front-matter header. The header carries the audit trail
 * (question, format, provider, date, sourcing summary); the body is
 * the assembled sections in the format's declared order.
 *
 * The output is deliberately COLOR-FREE — it is meant to be piped to
 * a file, opened in an editor, or fed to a Markdown-to-PDF pipeline.
 * ANSI codes would corrupt those downstream consumers.
 */
export function renderFullBrief(result: BriefResult): string {
  const parts: string[] = [];

  parts.push("---\n");
  parts.push(`question: ${yamlString(result.question)}\n`);
  parts.push(`format: ${yamlString(result.format_id)}\n`);
  parts.push(`provider: ${yamlString(result.provider_name)}\n`);
  parts.push(`generated_at: ${yamlString(result.generated_at)}\n`);
  parts.push(`recommended_option: ${yamlString(result.options.recommended_option_id)}\n`);
  parts.push(`aggregated_risk: ${yamlString(result.risks.aggregated_risk_score.overall)}\n`);
  parts.push(
    `sourcing_summary: "total=${result.sourcing_report.total_items} ` +
      `ok=${result.sourcing_report.counts.ok} ` +
      `stale=${result.sourcing_report.counts.stale} ` +
      `untrusted=${result.sourcing_report.counts.untrusted} ` +
      `duplicated=${result.sourcing_report.counts.duplicated} ` +
      `missing=${result.sourcing_report.counts.missing}"\n`
  );
  parts.push(`total_word_count: ${result.synthesis.total_word_count}\n`);
  parts.push(
    `target_word_count: ${result.synthesis.format_conformance.target_words}\n`
  );
  parts.push(
    `word_deviation_pct: ${result.synthesis.format_conformance.deviation_pct}\n`
  );
  parts.push("---\n\n");

  parts.push(`# ${escapeMarkdownHeading(result.question)}\n\n`);

  for (const section of result.synthesis.sections) {
    parts.push(`## ${escapeMarkdownHeading(section.title)}\n\n`);
    parts.push(section.content_markdown.trim() + "\n\n");
    if (section.sources_cited.length > 0) {
      parts.push("**Sources:**\n\n");
      for (const s of section.sources_cited) {
        parts.push(`- [${escapeMarkdownLinkText(s.title)}](${s.url})\n`);
      }
      parts.push("\n");
    }
    if (section.validation_issues.length > 0) {
      parts.push("<!-- Validation issues:\n");
      for (const issue of section.validation_issues) {
        parts.push(`  - ${issue}\n`);
      }
      parts.push("-->\n\n");
    }
  }

  return parts.join("");
}

/**
 * A safe YAML string encoder for scalar values that may contain
 * quotes or colons. Uses double-quotes and escapes embedded quotes
 * and backslashes.
 */
function yamlString(v: string): string {
  const escaped = v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function escapeMarkdownHeading(v: string): string {
  return v.replace(/[\r\n]+/g, " ");
}

function escapeMarkdownLinkText(v: string): string {
  return v.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

// ---------------------------------------------------------------------------
// Adversarial critique inline renderer (v0.7).
// ---------------------------------------------------------------------------

import type { AdversarialCritiqueResult } from "../agents/types.ts";

/**
 * Render a critique result as ANSI text (for stdout). Colour is
 * driven by severity — critical=red, material=yellow, minor=dim.
 */
export function renderCritiqueInline(result: AdversarialCritiqueResult): string {
  const parts: string[] = [];
  parts.push(`\n${c.bold(c.cyan("Adversarial Critique"))}\n`);
  parts.push(`${c.dim("=".repeat(20))}\n`);
  const robustColor =
    result.recommendation_robustness === "low"
      ? c.red
      : result.recommendation_robustness === "medium"
        ? c.yellow
        : c.green;
  parts.push(
    `${c.dim("Robustness:")} ${robustColor(result.recommendation_robustness)}  |  ` +
      `${c.dim("Critiques:")} ${result.critiques.length}  |  ` +
      `${c.red(`critical=${result.critical_count}`)} ${c.yellow(`material=${result.material_count}`)} ${c.dim(`minor=${result.minor_count}`)}\n`
  );
  parts.push(
    `${c.dim("Revision needed:")} ${result.revised_recommendation_needed ? c.red("yes") : c.green("no")}\n\n`
  );

  if (result.steelmanned_alternative !== null) {
    parts.push(`${c.bold("Steelmanned alternative")}\n`);
    parts.push(`  ${result.steelmanned_alternative}\n\n`);
  }

  for (const crit of result.critiques) {
    const sevColor =
      crit.severity === "critical"
        ? c.red
        : crit.severity === "material"
          ? c.yellow
          : c.dim;
    parts.push(
      `${c.bold(crit.id)} ${sevColor(`[${crit.severity}]`)} ${c.dim(crit.category)}\n`
    );
    parts.push(`  ${c.dim("target:")}      ${describeTarget(crit.target)}\n`);
    parts.push(`  ${c.dim("steelman:")}    ${crit.steelmanned_position}\n`);
    parts.push(`  ${c.dim("implication:")} ${crit.implication_if_true}\n`);
    parts.push(`  ${c.dim("revise:")}      ${crit.suggested_revision}\n`);
    if ("url" in crit.counter_evidence) {
      parts.push(`  ${c.dim("evidence:")}    ${c.blue(crit.counter_evidence.url)}\n`);
    } else {
      parts.push(
        `  ${c.yellow("evidence:")}    ${c.yellow("[SOURCE MISSING]")} ${c.dim("searched:")} ${crit.counter_evidence.searched_for}\n`
      );
    }
    parts.push("\n");
  }

  return parts.join("");
}

function describeTarget(t: {
  section_id?: string;
  option_id?: string;
  risk_id?: string;
  stakeholder_name?: string;
  finding_index?: number;
}): string {
  const bits: string[] = [];
  if (t.section_id !== undefined) bits.push(`section=${t.section_id}`);
  if (t.option_id !== undefined) bits.push(`option=${t.option_id}`);
  if (t.risk_id !== undefined) bits.push(`risk=${t.risk_id}`);
  if (t.stakeholder_name !== undefined) bits.push(`stakeholder='${t.stakeholder_name}'`);
  if (t.finding_index !== undefined) bits.push(`finding[${t.finding_index}]`);
  return bits.join(" · ") || "(empty)";
}
