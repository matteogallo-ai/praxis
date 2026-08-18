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
