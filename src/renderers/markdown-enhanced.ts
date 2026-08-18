/**
 * Enhanced Markdown renderer (v0.7).
 *
 * Extends the v0.6 `renderFullBrief()` plain-Markdown output with:
 *   - a table of contents (opt-in via `include_toc`)
 *   - a dedicated Sources section with de-duplicated,
 *     domain-sorted references
 *   - optional Adversarial Critique section (when the brief carries
 *     one and `include_critique` is set)
 *   - optional Appendices (findings, stakeholder table, risk register)
 *   - richer YAML front-matter (adds critique summary when present)
 *
 * The output is ANSI-free by design — the file is meant to be
 * piped, opened, or fed to a Markdown-to-PDF pipeline. Nothing here
 * depends on the CLI colour helpers.
 */

import type {
  BriefResult,
  BriefWithCritiqueResult,
} from "../orchestrator/orchestrator.ts";
import type { SourceReference } from "../sourcing/types.ts";
import type { RenderOptions, Renderer } from "./types.ts";
import { hasCritique } from "./types.ts";

/**
 * A `Renderer` returning a UTF-8 Buffer holding the enhanced
 * Markdown document.
 */
export const markdownEnhancedRenderer: Renderer = {
  target: "md-enhanced",
  async render(brief, options = {}) {
    const md = renderMarkdownEnhanced(brief, options);
    return Buffer.from(md, "utf-8");
  },
};

/**
 * Pure function that returns the Markdown as a string. Exposed
 * separately for unit tests that want to inspect content without
 * decoding a Buffer.
 */
export function renderMarkdownEnhanced(
  brief: BriefResult | BriefWithCritiqueResult,
  options: RenderOptions = {}
): string {
  const parts: string[] = [];
  parts.push(renderFrontMatter(brief));
  parts.push(`# ${escapeMarkdownHeading(brief.question)}\n\n`);

  if (options.include_toc) {
    parts.push(renderToc(brief, options));
  }

  for (const section of brief.synthesis.sections) {
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
      for (const issue of section.validation_issues) parts.push(`  - ${issue}\n`);
      parts.push("-->\n\n");
    }
  }

  if (options.include_critique && hasCritique(brief)) {
    parts.push(renderCritiqueSection(brief));
  }

  if (options.include_appendices) {
    parts.push(renderAppendices(brief));
  }

  parts.push(renderSourcesSection(brief, options));

  return parts.join("");
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function renderFrontMatter(brief: BriefResult | BriefWithCritiqueResult): string {
  const parts: string[] = ["---\n"];
  parts.push(`question: ${yamlString(brief.question)}\n`);
  parts.push(`format: ${yamlString(brief.format_id)}\n`);
  parts.push(`provider: ${yamlString(brief.provider_name)}\n`);
  parts.push(`generated_at: ${yamlString(brief.generated_at)}\n`);
  parts.push(`recommended_option: ${yamlString(brief.options.recommended_option_id)}\n`);
  parts.push(`aggregated_risk: ${yamlString(brief.risks.aggregated_risk_score.overall)}\n`);
  parts.push(
    `sourcing_summary: "total=${brief.sourcing_report.total_items} ` +
      `ok=${brief.sourcing_report.counts.ok} ` +
      `stale=${brief.sourcing_report.counts.stale} ` +
      `untrusted=${brief.sourcing_report.counts.untrusted} ` +
      `duplicated=${brief.sourcing_report.counts.duplicated} ` +
      `missing=${brief.sourcing_report.counts.missing}"\n`
  );
  if (hasCritique(brief)) {
    const a = brief.adversarial;
    parts.push(
      `critique_summary: "critiques=${a.critiques.length} ` +
        `critical=${a.critical_count} material=${a.material_count} ` +
        `minor=${a.minor_count} robustness=${a.recommendation_robustness} ` +
        `revised_needed=${a.revised_recommendation_needed}"\n`
    );
  }
  parts.push(`total_word_count: ${brief.synthesis.total_word_count}\n`);
  parts.push(
    `target_word_count: ${brief.synthesis.format_conformance.target_words}\n`
  );
  parts.push(
    `word_deviation_pct: ${brief.synthesis.format_conformance.deviation_pct}\n`
  );
  parts.push("---\n\n");
  return parts.join("");
}

function renderToc(
  brief: BriefResult | BriefWithCritiqueResult,
  options: RenderOptions
): string {
  const parts: string[] = ["## Table of Contents\n\n"];
  for (const s of brief.synthesis.sections) {
    parts.push(`- [${s.title}](#${slugify(s.title)})\n`);
  }
  if (options.include_critique && hasCritique(brief)) {
    parts.push(`- [Adversarial Critique](#adversarial-critique)\n`);
  }
  if (options.include_appendices) {
    parts.push(`- [Appendix A — Findings](#appendix-a--findings)\n`);
    parts.push(`- [Appendix B — Stakeholders](#appendix-b--stakeholders)\n`);
    parts.push(`- [Appendix C — Risk Register](#appendix-c--risk-register)\n`);
  }
  parts.push(`- [Sources](#sources)\n\n`);
  return parts.join("");
}

function renderCritiqueSection(brief: BriefWithCritiqueResult): string {
  const parts: string[] = ["## Adversarial Critique\n\n"];
  const a = brief.adversarial;
  parts.push(
    `**Robustness:** ${a.recommendation_robustness} · ` +
      `**Critiques:** ${a.critiques.length} ` +
      `(critical=${a.critical_count}, material=${a.material_count}, minor=${a.minor_count}) · ` +
      `**Revision needed:** ${a.revised_recommendation_needed ? "yes" : "no"}\n\n`
  );
  if (a.steelmanned_alternative !== null) {
    parts.push(
      `**Steelmanned alternative to the current recommendation:** ${a.steelmanned_alternative}\n\n`
    );
  }
  for (const c of a.critiques) {
    parts.push(`### ${c.id} — ${c.category} (${c.severity})\n\n`);
    parts.push(`**Steelmanned position:** ${c.steelmanned_position}\n\n`);
    parts.push(`**Implication if true:** ${c.implication_if_true}\n\n`);
    parts.push(`**Suggested revision:** ${c.suggested_revision}\n\n`);
    if ("url" in c.counter_evidence) {
      parts.push(
        `**Counter-evidence:** [${escapeMarkdownLinkText(c.counter_evidence.title)}](${c.counter_evidence.url})\n\n`
      );
    } else {
      parts.push(
        `**Counter-evidence:** _SOURCE_MISSING_ — searched for: ${c.counter_evidence.searched_for}\n\n`
      );
    }
  }
  return parts.join("");
}

function renderAppendices(brief: BriefResult | BriefWithCritiqueResult): string {
  const parts: string[] = [];

  // Appendix A — Findings.
  parts.push("## Appendix A — Findings\n\n");
  for (const [i, f] of brief.research.findings.entries()) {
    parts.push(`### Finding ${i + 1}\n\n`);
    parts.push(`**Claim:** ${f.claim}\n\n`);
    parts.push(`**Evidence:** ${f.supporting_evidence}\n\n`);
    if ("url" in f.source) {
      parts.push(
        `**Source:** [${escapeMarkdownLinkText(f.source.title)}](${f.source.url})\n\n`
      );
    } else {
      parts.push(
        `**Source:** _SOURCE_MISSING_ — searched for: ${f.source.searched_for}\n\n`
      );
    }
  }

  // Appendix B — Stakeholders.
  parts.push("## Appendix B — Stakeholders\n\n");
  parts.push("| Name | Category | Position | Power | Priority |\n");
  parts.push("|---|---|---|---|---|\n");
  for (const s of brief.stakeholders.stakeholders) {
    parts.push(
      `| ${mdCell(s.name)} | ${s.category} | ${s.position} | ${s.power} | ${s.priority} |\n`
    );
  }
  parts.push("\n");

  // Appendix C — Risk register.
  parts.push("## Appendix C — Risk Register\n\n");
  parts.push("| ID | Category | Likelihood | Impact | Timeframe |\n");
  parts.push("|---|---|---|---|---|\n");
  for (const r of brief.risks.risks) {
    parts.push(
      `| ${r.id} | ${r.category} | ${r.likelihood} | ${r.impact} | ${r.timeframe} |\n`
    );
  }
  parts.push("\n");

  return parts.join("");
}

function renderSourcesSection(
  brief: BriefResult | BriefWithCritiqueResult,
  _options: RenderOptions
): string {
  const parts: string[] = ["## Sources\n\n"];
  const seen = new Map<string, SourceReference>();

  // Aggregate from every upstream artefact.
  for (const f of brief.research.findings) {
    if ("url" in f.source) addUnique(seen, f.source);
  }
  for (const s of brief.stakeholders.stakeholders) {
    if ("url" in s.position_evidence) addUnique(seen, s.position_evidence);
  }
  for (const r of brief.risks.risks) {
    if ("url" in r.likelihood_evidence) addUnique(seen, r.likelihood_evidence);
    if ("url" in r.impact_evidence) addUnique(seen, r.impact_evidence);
  }
  for (const o of brief.options.options) {
    if ("url" in o.supporting_evidence) addUnique(seen, o.supporting_evidence);
  }
  if (hasCritique(brief)) {
    for (const c of brief.adversarial.critiques) {
      if ("url" in c.counter_evidence) addUnique(seen, c.counter_evidence);
    }
  }

  if (seen.size === 0) {
    parts.push("_No sources cited._\n");
    return parts.join("");
  }

  // Group by domain (host), sort domains alphabetically.
  const byDomain = new Map<string, SourceReference[]>();
  for (const src of seen.values()) {
    const host = extractHost(src.url);
    if (!byDomain.has(host)) byDomain.set(host, []);
    byDomain.get(host)!.push(src);
  }
  const domains = [...byDomain.keys()].sort();
  for (const domain of domains) {
    parts.push(`### ${domain}\n\n`);
    for (const s of byDomain.get(domain)!.sort((a, b) => a.title.localeCompare(b.title))) {
      parts.push(`- [${escapeMarkdownLinkText(s.title)}](${s.url}) · accessed ${s.accessed_at}\n`);
    }
    parts.push("\n");
  }

  return parts.join("");
}

function addUnique(
  map: Map<string, SourceReference>,
  src: SourceReference
): void {
  if (!map.has(src.url)) map.set(src.url, src);
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

function extractHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return "(unparseable)";
  }
}

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

/** Table-cell escaping (pipes need to be escaped in Markdown tables). */
function mdCell(v: string): string {
  return v.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

function slugify(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
