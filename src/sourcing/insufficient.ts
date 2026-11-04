/**
 * The "Insufficiently sourced" section a degraded briefing carries: every
 * item that failed the format's strict sourcing check, written by code from
 * the sourcing report so that it cannot be softened by a model.
 */

import type {
  ResearchResult,
  RiskAnalysisResult,
  StakeholderMapResult,
  SynthesizedSection,
} from "../agents/types.ts";
import { codeSpan, codeWrittenSection, oneLine } from "./code-written-section.ts";
import { isBlockingUnderStrict } from "./errors.ts";
import type { SourcingReport, SourcingWarning } from "./types.ts";

export const INSUFFICIENTLY_SOURCED_SECTION_ID = "insufficiently-sourced";

export interface SourcedArtefacts {
  research?: ResearchResult;
  stakeholders?: StakeholderMapResult;
  risks?: RiskAnalysisResult;
}

export function buildInsufficientlySourcedSection(
  report: SourcingReport,
  artefacts: SourcedArtefacts
): SynthesizedSection {
  const lines = [
    ...report.warnings.filter(isBlockingUnderStrict).map((w) => `- ${oneLine(describe(w, artefacts))}`),
    // Critique citations never block (orchestrator), so only options' are listed.
    ...(report.untrusted_citations ?? [])
      .filter((c) => c.stage === "options")
      .map((c) => `- ${oneLine(`**Option ${c.id}**: ${codeSpan(c.url)} is not a trusted domain (${codeSpan(c.reason)}).`)}`),
  ];
  const content_markdown = [
    `This format's sourcing policy is strict. The ${lines.length} item(s) below did not meet it.`,
    "They stayed in the analysis that produced this briefing; treat every statement",
    "that rests on them as unverified.",
    "",
    ...lines,
    "",
  ].join("\n");
  return codeWrittenSection(INSUFFICIENTLY_SOURCED_SECTION_ID, "Insufficiently sourced", content_markdown);
}

function describe(w: SourcingWarning, a: SourcedArtefacts): string {
  switch (w.kind) {
    case "missing_source": {
      const claim = a.research?.findings[w.finding_index]?.claim;
      const what = claim === undefined ? "" : ` — “${claim}”`;
      return `**Research finding ${w.finding_index + 1}**${what}: no source found (searched for: ${codeSpan(w.searched_for)}).`;
    }
    case "missing_stakeholder_evidence":
      return `**Stakeholder ${w.stakeholder_name}**: position not sourced (searched for: ${codeSpan(w.searched_for)}).`;
    case "missing_risk_evidence":
      return `**Risk ${w.risk_id}** (${w.evidence_field.replace("_", " ")}): not sourced (searched for: ${codeSpan(w.searched_for)}).`;
    case "stale_source":
      return `**${w.agent} item ${w.item_index + 1}**: ${codeSpan(w.url)} is ${w.age_days} days old, past the format's limit.`;
    case "untrusted_domain":
      return `**${w.agent} item ${w.item_index + 1}**: ${codeSpan(w.url)} is not a trusted domain (${codeSpan(w.reason)}).`;
    case "duplicate_source":
      return `**${w.agent} item ${w.item_index + 1}**: duplicate of ${codeSpan(w.previous_url)}.`;
  }
}
