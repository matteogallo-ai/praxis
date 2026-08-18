/**
 * `word/document.xml` — the main document body. WordprocessingML
 * elements we emit:
 *
 *   <w:document>            root
 *     <w:body>              body
 *       <w:p>               paragraph
 *         <w:pPr>           paragraph properties (style, alignment)
 *         <w:r>             text run
 *           <w:rPr>         run properties (bold, italic)
 *           <w:t>           text (xml:space="preserve" preserves whitespace)
 *       <w:tbl>             table
 *         <w:tblPr>         table properties (style)
 *         <w:tr>            row
 *           <w:tc>          cell
 *             <w:p>         paragraph inside cell
 */

import type {
  BriefResult,
  BriefWithCritiqueResult,
} from "../../orchestrator/orchestrator.ts";
import { hasCritique, type RenderOptions } from "../types.ts";
import { XML_PROLOG, elem, escapeXmlText } from "./xml-builder.ts";

const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"`;

export function buildDocumentXml(
  brief: BriefResult | BriefWithCritiqueResult,
  options: RenderOptions
): string {
  const body: string[] = [];

  // Title.
  body.push(heading1(brief.question));
  body.push(smallLine(
    `Format: ${brief.format_id} · Provider: ${brief.provider_name} · Generated: ${brief.generated_at}`
  ));
  body.push(smallLine(
    `Recommended: ${brief.options.recommended_option_id} · ` +
      `Aggregated risk: ${brief.risks.aggregated_risk_score.overall} · ` +
      `Total words: ${brief.synthesis.total_word_count} / ${brief.synthesis.format_conformance.target_words}`
  ));

  // Optional TOC (plain — no interactive links; Word regenerates these on open).
  if (options.include_toc) {
    body.push(heading2("Table of Contents"));
    for (const s of brief.synthesis.sections) {
      body.push(bulletParagraph(s.title));
    }
    if (options.include_critique && hasCritique(brief)) {
      body.push(bulletParagraph("Adversarial Critique"));
    }
    if (options.include_appendices) {
      body.push(bulletParagraph("Appendix A — Findings"));
      body.push(bulletParagraph("Appendix B — Stakeholders"));
      body.push(bulletParagraph("Appendix C — Risk Register"));
    }
    body.push(bulletParagraph("Sources"));
  }

  // Sections.
  for (const section of brief.synthesis.sections) {
    body.push(heading2(section.title));
    for (const para of splitParagraphs(section.content_markdown)) {
      body.push(paragraph(para));
    }
    if (section.sources_cited.length > 0) {
      body.push(paragraph("Sources:", { bold: true }));
      for (const src of section.sources_cited) {
        body.push(bulletParagraph(`${src.title} — ${src.url}`));
      }
    }
  }

  // Options table.
  body.push(heading2("Options"));
  body.push(optionsTable(brief));

  // Risks table.
  body.push(heading2("Risks"));
  body.push(risksTable(brief));

  // Stakeholders table.
  body.push(heading2("Stakeholders"));
  body.push(stakeholdersTable(brief));

  // Adversarial critique.
  if (options.include_critique && hasCritique(brief)) {
    body.push(heading2("Adversarial Critique"));
    const a = brief.adversarial;
    body.push(paragraph(
      `Robustness: ${a.recommendation_robustness}. ` +
        `Critiques: ${a.critiques.length} ` +
        `(critical=${a.critical_count}, material=${a.material_count}, minor=${a.minor_count}). ` +
        `Revision needed: ${a.revised_recommendation_needed ? "yes" : "no"}.`
    ));
    if (a.steelmanned_alternative !== null) {
      body.push(paragraph("Steelmanned alternative:", { bold: true }));
      body.push(paragraph(a.steelmanned_alternative));
    }
    for (const c of a.critiques) {
      body.push(heading3(`${c.id} — ${c.category} (${c.severity})`));
      body.push(paragraph("Steelmanned position:", { bold: true }));
      body.push(paragraph(c.steelmanned_position));
      body.push(paragraph("Implication if true:", { bold: true }));
      body.push(paragraph(c.implication_if_true));
      body.push(paragraph("Suggested revision:", { bold: true }));
      body.push(paragraph(c.suggested_revision));
      body.push(paragraph("Counter-evidence:", { bold: true }));
      if ("url" in c.counter_evidence) {
        body.push(paragraph(`${c.counter_evidence.title} — ${c.counter_evidence.url}`));
      } else {
        body.push(paragraph(
          `SOURCE_MISSING — searched for: ${c.counter_evidence.searched_for}`
        ));
      }
    }
  }

  // Appendices.
  if (options.include_appendices) {
    body.push(heading2("Appendix A — Findings"));
    for (const [i, f] of brief.research.findings.entries()) {
      body.push(heading3(`Finding ${i + 1}`));
      body.push(paragraph(`Claim: ${f.claim}`));
      body.push(paragraph(`Evidence: ${f.supporting_evidence}`));
      if ("url" in f.source) {
        body.push(paragraph(`Source: ${f.source.title} — ${f.source.url}`));
      } else {
        body.push(paragraph(`Source: SOURCE_MISSING — searched for: ${f.source.searched_for}`));
      }
    }
    body.push(heading2("Appendix B — Stakeholders"));
    body.push(stakeholdersTable(brief));
    body.push(heading2("Appendix C — Risk Register"));
    body.push(risksTable(brief));
  }

  // Sources footer.
  body.push(heading2("Sources"));
  const allSources = collectSources(brief);
  if (allSources.length === 0) {
    body.push(paragraph("No sources cited."));
  } else {
    for (const s of allSources) {
      body.push(bulletParagraph(`${s.title} — ${s.url} (accessed ${s.accessed_at})`));
    }
  }

  // Optional sourcing report.
  if (options.include_sourcing_report) {
    body.push(heading2("Sourcing Report"));
    const sr = brief.sourcing_report;
    body.push(paragraph(
      `Policy: ${sr.policy}. Total items: ${sr.total_items}. ` +
        `OK: ${sr.counts.ok}, stale: ${sr.counts.stale}, ` +
        `untrusted: ${sr.counts.untrusted}, duplicated: ${sr.counts.duplicated}, ` +
        `missing: ${sr.counts.missing}.`
    ));
  }

  return (
    XML_PROLOG +
    `<w:document ${W_NS}>` +
    `<w:body>` +
    body.join("") +
    // sectPr closes the body — one section, portrait letter-ish.
    `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>` +
    `</w:body>` +
    `</w:document>`
  );
}

// ---------------------------------------------------------------------------
// Text primitives
// ---------------------------------------------------------------------------

function heading1(text: string): string {
  return (
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>` +
    run(text) +
    `</w:p>`
  );
}

function heading2(text: string): string {
  return (
    `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>` +
    run(text) +
    `</w:p>`
  );
}

function heading3(text: string): string {
  return (
    `<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr>` +
    run(text) +
    `</w:p>`
  );
}

function paragraph(text: string, opts: { bold?: boolean } = {}): string {
  return `<w:p>${run(text, opts)}</w:p>`;
}

function smallLine(text: string): string {
  return (
    `<w:p><w:pPr><w:pStyle w:val="Small"/></w:pPr>` +
    run(text) +
    `</w:p>`
  );
}

function bulletParagraph(text: string): string {
  // Not a "real" numbered list (numbering.xml would be required for that) —
  // but a bullet-like glyph prefix reads correctly in Word.
  return `<w:p>${run(`• ${text}`)}</w:p>`;
}

function run(text: string, opts: { bold?: boolean } = {}): string {
  const rPr = opts.bold ? `<w:rPr><w:b/></w:rPr>` : "";
  return (
    `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r>`
  );
}

/** Split Markdown-ish content into flat paragraphs (empty lines separate). */
function splitParagraphs(md: string): string[] {
  return md
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

function tableHeader(headers: string[]): string {
  return (
    `<w:tr>` +
    headers
      .map(
        (h) =>
          `<w:tc><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="E0E0E0"/></w:tcPr><w:p>${run(h, { bold: true })}</w:p></w:tc>`
      )
      .join("") +
    `</w:tr>`
  );
}

function tableRow(cells: string[]): string {
  return (
    `<w:tr>` +
    cells.map((c) => `<w:tc><w:p>${run(c)}</w:p></w:tc>`).join("") +
    `</w:tr>`
  );
}

function optionsTable(brief: BriefResult): string {
  const headers = ["ID", "Title", "Recommendation", "Time horizon"];
  const rows = brief.options.options.map((o) =>
    tableRow([o.id, o.title, o.recommendation_level, o.time_horizon])
  );
  return (
    `<w:tbl>` +
    `<w:tblPr><w:tblStyle w:val="PraxisTable"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    tableHeader(headers) +
    rows.join("") +
    `</w:tbl>`
  );
}

function risksTable(brief: BriefResult): string {
  const headers = ["ID", "Category", "Likelihood", "Impact", "Timeframe"];
  const rows = brief.risks.risks.map((r) =>
    tableRow([r.id, r.category, r.likelihood, r.impact, r.timeframe])
  );
  return (
    `<w:tbl>` +
    `<w:tblPr><w:tblStyle w:val="PraxisTable"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    tableHeader(headers) +
    rows.join("") +
    `</w:tbl>`
  );
}

function stakeholdersTable(brief: BriefResult): string {
  const headers = ["Name", "Position", "Power", "Priority"];
  const rows = brief.stakeholders.stakeholders.map((s) =>
    tableRow([s.name, s.position, s.power, s.priority])
  );
  return (
    `<w:tbl>` +
    `<w:tblPr><w:tblStyle w:val="PraxisTable"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    tableHeader(headers) +
    rows.join("") +
    `</w:tbl>`
  );
}

// ---------------------------------------------------------------------------
// Sources aggregation
// ---------------------------------------------------------------------------

interface Src {
  url: string;
  title: string;
  accessed_at: string;
}

function collectSources(brief: BriefResult | BriefWithCritiqueResult): Src[] {
  const seen = new Map<string, Src>();
  const add = (s: Src) => {
    if (!seen.has(s.url)) seen.set(s.url, s);
  };
  for (const f of brief.research.findings) {
    if ("url" in f.source) add(f.source);
  }
  for (const s of brief.stakeholders.stakeholders) {
    if ("url" in s.position_evidence) add(s.position_evidence);
  }
  for (const r of brief.risks.risks) {
    if ("url" in r.likelihood_evidence) add(r.likelihood_evidence);
    if ("url" in r.impact_evidence) add(r.impact_evidence);
  }
  for (const o of brief.options.options) {
    if ("url" in o.supporting_evidence) add(o.supporting_evidence);
  }
  if (hasCritique(brief)) {
    for (const c of brief.adversarial.critiques) {
      if ("url" in c.counter_evidence) add(c.counter_evidence);
    }
  }
  return [...seen.values()].sort((a, b) => a.title.localeCompare(b.title));
}

/** Re-exported so tests can spot-check without going through the assembler. */
export { collectSources };

// Utility export so xml-builder's `elem` compiles even though not used directly here.
void elem;
