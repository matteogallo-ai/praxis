/**
 * PDF renderer (v0.7) — via pdfkit.
 *
 * pdfkit is the SOLE external runtime dependency of Praxis. See
 * CHANGELOG v0.7 for the justification. Every other renderer in
 * this release is from-scratch.
 *
 * Layout:
 *
 *   Cover page:     briefing title, format id, generated_at,
 *                   provider, recommended_option, aggregated_risk
 *   Page 2+:        optional TOC (if include_toc)
 *   Section pages:  every synthesis section as H2 + body
 *   Options table:  ID / Title / Recommendation / Time horizon
 *   Risks table:    ID / Category / Likelihood / Impact / Timeframe
 *   Stakeholders:   Name / Position / Power / Priority
 *   Critique:       if include_critique + briefWithCritique
 *   Appendices:     Findings, Stakeholders, Risk register
 *   Sources:        de-duplicated, sorted by domain
 *   Sourcing report: if include_sourcing_report
 *
 * Themes (`professional` / `government` / `consulting`) affect the
 * accent colour and headline font choice only. Body text stays
 * legible across themes.
 */

import PDFDocument from "pdfkit";

import type {
  BriefResult,
  BriefWithCritiqueResult,
} from "../orchestrator/orchestrator.ts";
import type { Renderer, RenderOptions, RenderTheme } from "./types.ts";
import { hasCritique } from "./types.ts";
import { RenderError } from "./errors.ts";

// ---------------------------------------------------------------------------
// Theme table
// ---------------------------------------------------------------------------

interface ThemeColors {
  accent: string;
  headingFont: string;
  bodyFont: string;
  bodyBold: string;
  subtle: string;
}

const THEMES: Record<RenderTheme, ThemeColors> = {
  professional: {
    accent: "#0B3D91", // navy
    headingFont: "Helvetica-Bold",
    bodyFont: "Helvetica",
    bodyBold: "Helvetica-Bold",
    subtle: "#606060",
  },
  government: {
    accent: "#7A0019", // maroon
    headingFont: "Times-Bold",
    bodyFont: "Times-Roman",
    bodyBold: "Times-Bold",
    subtle: "#4A4A4A",
  },
  consulting: {
    accent: "#D97706", // amber
    headingFont: "Helvetica-Bold",
    bodyFont: "Helvetica",
    bodyBold: "Helvetica-Bold",
    subtle: "#525252",
  },
};

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export const pdfRenderer: Renderer = {
  target: "pdf",
  async render(brief, options = {}) {
    try {
      return await buildPdf(brief, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new RenderError("pdf", `assembly failed — ${message}`);
    }
  },
};

async function buildPdf(
  brief: BriefResult | BriefWithCritiqueResult,
  options: RenderOptions
): Promise<Buffer> {
  const theme = THEMES[options.theme ?? "professional"];
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 72, bottom: 72, left: 72, right: 72 },
    autoFirstPage: false,
    bufferPages: true,
    compress: options.compress_pdf_streams !== false,
    info: {
      Title: brief.question,
      Author: "Praxis",
      Subject: brief.format_id,
      Producer: "Praxis (pdfkit)",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", (err: Error) => reject(err));
  });

  // Cover page.
  doc.addPage();
  renderCover(doc, brief, theme);

  // TOC.
  if (options.include_toc) {
    doc.addPage();
    renderToc(doc, brief, theme, options);
  }

  // Sections.
  for (const section of brief.synthesis.sections) {
    doc.addPage();
    renderSection(doc, section, theme);
  }

  // Options / risks / stakeholders.
  doc.addPage();
  renderOptionsTable(doc, brief, theme);
  doc.addPage();
  renderRisksTable(doc, brief, theme);
  doc.addPage();
  renderStakeholdersTable(doc, brief, theme);

  // Critique.
  if (options.include_critique && hasCritique(brief)) {
    doc.addPage();
    renderCritique(doc, brief, theme);
  }

  // Appendices.
  if (options.include_appendices) {
    doc.addPage();
    renderAppendices(doc, brief, theme);
  }

  // Sources.
  doc.addPage();
  renderSources(doc, brief, theme);

  // Sourcing report.
  if (options.include_sourcing_report) {
    doc.addPage();
    renderSourcingReport(doc, brief, theme);
  }

  // Add footers to every page (buffered — pageAdded footers cause
  // recursion when the footer text itself overflows a page).
  addFooters(doc, brief, theme);

  doc.end();
  await done;
  return Buffer.concat(chunks);
}

function addFooters(
  doc: Doc,
  brief: BriefResult | BriefWithCritiqueResult,
  theme: ThemeColors
): void {
  const q =
    brief.question.length > 60
      ? brief.question.slice(0, 57) + "…"
      : brief.question;
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - 40;
    const width =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    doc
      .fontSize(9)
      .font(theme.bodyFont)
      .fillColor(theme.subtle)
      .text(`Praxis briefing · ${q}`, doc.page.margins.left, y, {
        width: width - 60,
        align: "left",
        lineBreak: false,
      })
      .text(`p. ${i + 1} / ${range.count}`, doc.page.margins.left, y, {
        width,
        align: "right",
        lineBreak: false,
      });
  }
}

// ---------------------------------------------------------------------------
// Page components
// ---------------------------------------------------------------------------

// A concrete pdfkit doc type — using `unknown` avoids `any` while
// keeping pdfkit's chainable API usable via casting at each call.
type Doc = PDFKit.PDFDocument;

function renderCover(
  doc: Doc,
  brief: BriefResult | BriefWithCritiqueResult,
  theme: ThemeColors
): void {
  doc
    .fontSize(32)
    .font(theme.headingFont)
    .fillColor("#000000")
    .text(brief.question, { align: "left" });
  doc.moveDown(1);
  doc
    .fontSize(11)
    .font(theme.bodyFont)
    .fillColor(theme.subtle)
    .text(`Format: ${brief.format_id}`)
    .text(`Provider: ${brief.provider_name}`)
    .text(`Generated at: ${brief.generated_at}`);
  doc.moveDown(2);
  doc
    .fontSize(14)
    .font(theme.bodyBold)
    .fillColor(theme.accent)
    .text(`Recommended option: ${brief.options.recommended_option_id}`);
  doc
    .fontSize(12)
    .font(theme.bodyFont)
    .fillColor("#000000")
    .text(`Aggregated risk: ${brief.risks.aggregated_risk_score.overall}`)
    .text(
      `Words: ${brief.synthesis.total_word_count} / ${brief.synthesis.format_conformance.target_words} target`
    );
  if (hasCritique(brief)) {
    doc.moveDown(1);
    doc
      .fontSize(12)
      .font(theme.bodyBold)
      .fillColor(theme.accent)
      .text(`Robustness: ${brief.adversarial.recommendation_robustness}`);
    doc
      .fontSize(11)
      .font(theme.bodyFont)
      .fillColor("#000000")
      .text(
        `Critiques: ${brief.adversarial.critiques.length} ` +
          `(critical=${brief.adversarial.critical_count}, ` +
          `material=${brief.adversarial.material_count}, ` +
          `minor=${brief.adversarial.minor_count})`
      );
    doc.text(
      `Revision needed: ${brief.adversarial.revised_recommendation_needed ? "yes" : "no"}`
    );
  }
}

function renderToc(
  doc: Doc,
  brief: BriefResult | BriefWithCritiqueResult,
  theme: ThemeColors,
  options: RenderOptions
): void {
  h1(doc, "Table of Contents", theme);
  doc.font(theme.bodyFont).fontSize(12).fillColor("#000000");
  for (const s of brief.synthesis.sections) {
    doc.text(`•  ${s.title}`);
  }
  doc.text("•  Options");
  doc.text("•  Risks");
  doc.text("•  Stakeholders");
  if (options.include_critique && hasCritique(brief)) {
    doc.text("•  Adversarial Critique");
  }
  if (options.include_appendices) {
    doc.text("•  Appendix A — Findings");
    doc.text("•  Appendix B — Stakeholders");
    doc.text("•  Appendix C — Risk Register");
  }
  doc.text("•  Sources");
  if (options.include_sourcing_report) {
    doc.text("•  Sourcing Report");
  }
}

function renderSection(
  doc: Doc,
  section: BriefResult["synthesis"]["sections"][number],
  theme: ThemeColors
): void {
  h1(doc, section.title, theme);
  doc.font(theme.bodyFont).fontSize(11).fillColor("#000000");
  doc.text(section.content_markdown, { align: "left" });
  if (section.sources_cited.length > 0) {
    doc.moveDown(0.5);
    doc.font(theme.bodyBold).text("Sources:", { continued: false });
    doc.font(theme.bodyFont);
    for (const s of section.sources_cited) {
      doc.text(`•  ${s.title} — ${s.url}`, { indent: 12 });
    }
  }
}

function renderOptionsTable(doc: Doc, brief: BriefResult, theme: ThemeColors): void {
  h1(doc, "Options", theme);
  table(doc, theme, ["ID", "Title", "Recommendation", "Time horizon"], brief.options.options.map((o) => [
    o.id,
    o.title,
    o.recommendation_level,
    o.time_horizon,
  ]));
}

function renderRisksTable(doc: Doc, brief: BriefResult, theme: ThemeColors): void {
  h1(doc, "Risks", theme);
  table(doc, theme, ["ID", "Category", "Likelihood", "Impact", "Timeframe"], brief.risks.risks.map((r) => [
    r.id,
    r.category,
    r.likelihood,
    r.impact,
    r.timeframe,
  ]));
}

function renderStakeholdersTable(doc: Doc, brief: BriefResult, theme: ThemeColors): void {
  h1(doc, "Stakeholders", theme);
  table(doc, theme, ["Name", "Position", "Power", "Priority"], brief.stakeholders.stakeholders.map((s) => [
    s.name,
    s.position,
    s.power,
    s.priority,
  ]));
}

function renderCritique(
  doc: Doc,
  brief: BriefWithCritiqueResult,
  theme: ThemeColors
): void {
  h1(doc, "Adversarial Critique", theme);
  const a = brief.adversarial;
  doc.font(theme.bodyFont).fontSize(11).fillColor("#000000")
    .text(`Robustness: ${a.recommendation_robustness}`)
    .text(`Critiques: ${a.critiques.length} (critical=${a.critical_count}, material=${a.material_count}, minor=${a.minor_count})`)
    .text(`Revision needed: ${a.revised_recommendation_needed ? "yes" : "no"}`);
  if (a.steelmanned_alternative !== null) {
    doc.moveDown(0.5);
    doc.font(theme.bodyBold).text("Steelmanned alternative:");
    doc.font(theme.bodyFont).text(a.steelmanned_alternative);
  }
  for (const c of a.critiques) {
    doc.moveDown(0.8);
    h3(doc, `${c.id} — ${c.category} (${c.severity})`, theme);
    labelled(doc, theme, "Steelmanned position:", c.steelmanned_position);
    labelled(doc, theme, "Implication if true:", c.implication_if_true);
    labelled(doc, theme, "Suggested revision:", c.suggested_revision);
    labelled(
      doc,
      theme,
      "Counter-evidence:",
      "url" in c.counter_evidence
        ? `${c.counter_evidence.title} — ${c.counter_evidence.url}`
        : `SOURCE_MISSING — searched for: ${c.counter_evidence.searched_for}`
    );
  }
}

function renderAppendices(
  doc: Doc,
  brief: BriefResult | BriefWithCritiqueResult,
  theme: ThemeColors
): void {
  h1(doc, "Appendix A — Findings", theme);
  for (const [i, f] of brief.research.findings.entries()) {
    h3(doc, `Finding ${i + 1}`, theme);
    labelled(doc, theme, "Claim:", f.claim);
    labelled(doc, theme, "Evidence:", f.supporting_evidence);
    labelled(
      doc,
      theme,
      "Source:",
      "url" in f.source
        ? `${f.source.title} — ${f.source.url}`
        : `SOURCE_MISSING — searched for: ${f.source.searched_for}`
    );
    doc.moveDown(0.3);
  }
  doc.addPage();
  h1(doc, "Appendix B — Stakeholders", theme);
  table(doc, theme, ["Name", "Category", "Position", "Power", "Priority"], brief.stakeholders.stakeholders.map((s) => [
    s.name,
    s.category,
    s.position,
    s.power,
    s.priority,
  ]));
  doc.addPage();
  h1(doc, "Appendix C — Risk Register", theme);
  table(doc, theme, ["ID", "Category", "Likelihood", "Impact", "Timeframe"], brief.risks.risks.map((r) => [
    r.id,
    r.category,
    r.likelihood,
    r.impact,
    r.timeframe,
  ]));
}

function renderSources(
  doc: Doc,
  brief: BriefResult | BriefWithCritiqueResult,
  theme: ThemeColors
): void {
  h1(doc, "Sources", theme);
  const seen = new Map<string, { url: string; title: string; accessed_at: string }>();
  const add = (s: { url: string; title: string; accessed_at: string }) => {
    if (!seen.has(s.url)) seen.set(s.url, s);
  };
  for (const f of brief.research.findings) if ("url" in f.source) add(f.source);
  for (const s of brief.stakeholders.stakeholders)
    if ("url" in s.position_evidence) add(s.position_evidence);
  for (const r of brief.risks.risks) {
    if ("url" in r.likelihood_evidence) add(r.likelihood_evidence);
    if ("url" in r.impact_evidence) add(r.impact_evidence);
  }
  for (const o of brief.options.options)
    if ("url" in o.supporting_evidence) add(o.supporting_evidence);
  if (hasCritique(brief)) {
    for (const c of brief.adversarial.critiques)
      if ("url" in c.counter_evidence) add(c.counter_evidence);
  }
  if (seen.size === 0) {
    doc.font(theme.bodyFont).fontSize(11).text("No sources cited.");
    return;
  }
  const sorted = [...seen.values()].sort((a, b) => domainOf(a.url).localeCompare(domainOf(b.url)));
  let currentDomain = "";
  doc.font(theme.bodyFont).fontSize(11);
  for (const s of sorted) {
    const d = domainOf(s.url);
    if (d !== currentDomain) {
      currentDomain = d;
      doc.moveDown(0.4);
      doc.font(theme.bodyBold).fillColor(theme.accent).text(d);
      doc.font(theme.bodyFont).fillColor("#000000");
    }
    doc.text(`•  ${s.title} — ${s.url} (accessed ${s.accessed_at})`, { indent: 12 });
  }
}

function renderSourcingReport(
  doc: Doc,
  brief: BriefResult | BriefWithCritiqueResult,
  theme: ThemeColors
): void {
  h1(doc, "Sourcing Report", theme);
  const sr = brief.sourcing_report;
  doc.font(theme.bodyFont).fontSize(11).fillColor("#000000")
    .text(`Policy: ${sr.policy}`)
    .text(`Total items: ${sr.total_items}`)
    .text(`OK: ${sr.counts.ok} · stale: ${sr.counts.stale} · untrusted: ${sr.counts.untrusted} · duplicated: ${sr.counts.duplicated} · missing: ${sr.counts.missing}`);
  if (sr.warnings.length > 0) {
    doc.moveDown(0.5);
    doc.font(theme.bodyBold).text("Warnings:");
    doc.font(theme.bodyFont);
    for (const w of sr.warnings) {
      doc.text(`•  ${describeWarning(w)}`, { indent: 12 });
    }
  }
}

// ---------------------------------------------------------------------------
// Low-level building blocks
// ---------------------------------------------------------------------------

function h1(doc: Doc, text: string, theme: ThemeColors): void {
  doc
    .fontSize(20)
    .font(theme.headingFont)
    .fillColor("#000000")
    .text(text);
  doc.moveDown(0.5);
}

function h3(doc: Doc, text: string, theme: ThemeColors): void {
  doc
    .fontSize(13)
    .font(theme.bodyBold)
    .fillColor(theme.subtle)
    .text(text);
  doc.moveDown(0.2);
  doc.fontSize(11).font(theme.bodyFont).fillColor("#000000");
}

function labelled(doc: Doc, theme: ThemeColors, label: string, value: string): void {
  doc.font(theme.bodyBold).text(label);
  doc.font(theme.bodyFont).text(value);
  doc.moveDown(0.2);
}

function table(
  doc: Doc,
  theme: ThemeColors,
  headers: string[],
  rows: string[][]
): void {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colWidth = pageWidth / headers.length;
  const rowHeight = 20;
  let y = doc.y;

  // Header row.
  doc.save();
  doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).fillOpacity(0.12).fillAndStroke(theme.accent, theme.accent).fillOpacity(1);
  doc.restore();
  doc.font(theme.bodyBold).fontSize(10).fillColor("#000000");
  headers.forEach((h, i) => {
    doc.text(h, doc.page.margins.left + i * colWidth + 4, y + 6, {
      width: colWidth - 8,
      lineBreak: false,
    });
  });
  y += rowHeight;

  // Body rows.
  doc.font(theme.bodyFont).fontSize(10).fillColor("#000000");
  for (const row of rows) {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 40) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.rect(doc.page.margins.left, y, pageWidth, rowHeight).stroke("#C0C0C0");
    row.forEach((cell, i) => {
      doc.text(cell, doc.page.margins.left + i * colWidth + 4, y + 6, {
        width: colWidth - 8,
        lineBreak: false,
      });
    });
    y += rowHeight;
  }
  doc.moveTo(doc.page.margins.left, y);
  doc.y = y + 4;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "(unparseable)";
  }
}

function describeWarning(
  w: BriefResult["sourcing_report"]["warnings"][number]
): string {
  switch (w.kind) {
    case "missing_source":
      return `[research] finding[${w.finding_index}] SOURCE_MISSING — ${w.searched_for}`;
    case "missing_stakeholder_evidence":
      return `[stakeholder] '${w.stakeholder_name}' SOURCE_MISSING — ${w.searched_for}`;
    case "missing_risk_evidence":
      return `[risk] ${w.risk_id} .${w.evidence_field} SOURCE_MISSING — ${w.searched_for}`;
    case "stale_source":
      return `[${w.agent}] stale (${w.age_days} days${w.exceeds_max ? "; past max" : ""}): ${w.url}`;
    case "untrusted_domain":
      return `[${w.agent}] untrusted: ${w.url} — ${w.reason}`;
    case "duplicate_source":
      return `[${w.agent}] duplicate: ${w.url} vs [${w.previous_agent}] ${w.previous_url}`;
  }
}
