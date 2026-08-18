/**
 * PDF renderer tests (v0.7).
 *
 * pdfkit is the SOLE external dependency of Praxis, so we test both
 * the invocation (buffer > 1 KiB, valid PDF header) and the content
 * (via a byte-level substring scan since we do not include a PDF
 * parser).
 */

import { describe, expect, test } from "bun:test";

import { pdfRenderer } from "../../src/renderers/pdf.ts";
import type {
  BriefResult,
  BriefWithCritiqueResult,
} from "../../src/orchestrator/orchestrator.ts";

const SRC = {
  url: "https://reuters.com/pdf-test",
  title: "Reuters PDF piece",
  accessed_at: "2026-08-15T00:00:00Z",
  excerpt: "…",
};

/**
 * pdfkit encodes text content as hex strings inside `<...>` in
 * page content streams — AND it splits runs on kerning boundaries,
 * so `OPT-A` may appear as `<4f5054>-<41>` (multiple blocks).
 *
 * This helper checks whether the given literal text appears
 * either in plain form (metadata, info dict) OR by concatenating
 * every `<hex>` block in the buffer and searching the concatenated
 * hex string. Uncompressed streams are required
 * (`compress_pdf_streams: false`).
 */
function pdfContainsText(buf: Buffer, text: string): boolean {
  const raw = buf.toString("latin1");
  if (raw.includes(text)) return true;
  const hex = Array.from(text)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
  // Extract every <hex> block and concatenate (this collapses kerning breaks).
  const blocks = raw.match(/<[0-9a-fA-F]+>/g) ?? [];
  const concat = blocks.map((b) => b.slice(1, -1)).join("").toLowerCase();
  return concat.includes(hex);
}

function makeBrief(): BriefResult {
  return {
    scoping: {
      reformulated_question: "R?",
      hidden_questions: [],
      scope_boundaries: [],
      assumptions_to_validate: [],
    },
    research: {
      findings: [{ claim: "c", supporting_evidence: "e", source: SRC }],
      open_questions: [],
      search_queries_used: [],
    },
    stakeholders: {
      stakeholders: [
        {
          name: "Alpha",
          category: "decision-maker",
          interest: "…",
          position: "supportive",
          position_evidence: SRC,
          power: "high",
          priority: "critical",
          engagement_notes: "…",
        },
      ],
      key_dynamics: ["a", "b", "c"],
      blind_spots: [],
      coverage_confidence: "medium",
    },
    risks: {
      risks: [
        {
          id: "RISK-001",
          category: "strategic",
          description: "…",
          likelihood: "medium",
          impact: "moderate",
          likelihood_evidence: SRC,
          impact_evidence: SRC,
          affected_stakeholders: ["Alpha"],
          timeframe: "short-term",
          mitigations: ["Do X"],
          residual_risk_after_mitigation: "low",
        },
      ],
      aggregated_risk_score: { overall: "medium", by_category: { strategic: "medium" } },
      top_3_priorities: ["RISK-001"],
      unresolved_uncertainties: [],
    },
    options: {
      options: [
        {
          id: "OPT-A",
          title: "Do it",
          summary: "…",
          tradeoffs: [
            { dimension: "cost", assessment: "low" },
            { dimension: "time-to-market", assessment: "fast" },
            { dimension: "regulatory-exposure", assessment: "low" },
          ],
          stakeholder_impact: [
            { stakeholder_name: "Alpha", predicted_reaction: "supportive", impact_description: "…" },
          ],
          risks_mitigated: ["RISK-001"],
          risks_introduced: [],
          dependencies: [],
          time_horizon: "short-term",
          recommendation_level: "recommended",
          supporting_evidence: SRC,
        },
      ],
      recommended_option_id: "OPT-A",
      rationale_for_recommendation: "…",
      counter_arguments_considered: [],
      unresolved_uncertainties: [],
    },
    synthesis: {
      sections: [
        {
          section_id: "intro",
          title: "Intro",
          content_markdown: "The intro text with content.",
          word_count: 6,
          sources_cited: [SRC],
          validation_issues: [],
        },
      ],
      total_word_count: 6,
      format_conformance: {
        target_words: 800,
        actual_words: 6,
        deviation_pct: -99.3,
        sections_over_length: [],
        forbidden_terms_found: [],
        failed_validation_rules: [],
      },
    },
    sourcing_report: {
      policy: "strict",
      total_items: 5,
      counts: { ok: 5, stale: 0, untrusted: 0, duplicated: 0, missing: 0 },
      warnings: [],
      missing_sources_count: 0,
    },
    generated_at: "2026-08-18T12:00:00.000Z",
    format_id: "test-format",
    question: "Should we do the thing?",
    provider_name: "mock",
  };
}

function makeBriefWithCritique(): BriefWithCritiqueResult {
  return {
    ...makeBrief(),
    adversarial: {
      critiques: [
        {
          id: "CRIT-001",
          category: "hidden-assumption",
          severity: "critical",
          target: { section_id: "intro" },
          steelmanned_position:
            "A steelmanned position with enough words to pass the minimum length threshold enforced by the adversarial parser at execution time.",
          counter_evidence: SRC,
          implication_if_true: "Something would flip.",
          suggested_revision: "Do X.",
        },
      ],
      critical_count: 1,
      material_count: 0,
      minor_count: 0,
      recommendation_robustness: "medium",
      revised_recommendation_needed: true,
      steelmanned_alternative: "Consider alternative Y.",
    },
  };
}

// ---------------------------------------------------------------------------
// Basic PDF structure
// ---------------------------------------------------------------------------

describe("pdfRenderer — basic structure", () => {
  test("returns a Buffer > 1 KiB", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { compress_pdf_streams: false });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(1024);
  });

  test("starts with the '%PDF-' magic header", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { compress_pdf_streams: false });
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("ends with an '%%EOF' marker", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { compress_pdf_streams: false });
    // The EOF marker is somewhere in the trailing 32 bytes.
    const tail = buf.slice(-64).toString("ascii");
    expect(tail).toContain("%%EOF");
  });

  test("contains the briefing question and section heading (via metadata OR hex-encoded content)", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { compress_pdf_streams: false });
    // Question appears both in metadata `/Title` (plain) and page content (hex).
    expect(pdfContainsText(buf, "Should we do the thing?")).toBe(true);
    // Intro heading lives only in page content — hex-encoded.
    expect(pdfContainsText(buf, "Intro")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Options / theme
// ---------------------------------------------------------------------------

describe("pdfRenderer — themes", () => {
  test("professional theme renders (default)", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { compress_pdf_streams: false });
    expect(buf.length).toBeGreaterThan(1024);
  });

  test("government theme renders", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { theme: "government", compress_pdf_streams: false });
    expect(buf.length).toBeGreaterThan(1024);
  });

  test("consulting theme renders", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { theme: "consulting", compress_pdf_streams: false });
    expect(buf.length).toBeGreaterThan(1024);
  });
});

describe("pdfRenderer — optional sections", () => {
  test("include_toc renders a Table of Contents block (larger PDF)", async () => {
    const bufNo = await pdfRenderer.render(makeBrief(), { compress_pdf_streams: false });
    const bufYes = await pdfRenderer.render(makeBrief(), { include_toc: true, compress_pdf_streams: false });
    // TOC adds content — the yes version should be larger.
    expect(bufYes.length).toBeGreaterThan(bufNo.length);
    expect(pdfContainsText(bufYes, "Table of Contents")).toBe(true);
  });

  test("include_critique + briefWithCritique renders the critique heading", async () => {
    const buf = await pdfRenderer.render(makeBriefWithCritique(), {
      include_critique: true,
      compress_pdf_streams: false,
    });
    expect(pdfContainsText(buf, "Adversarial Critique")).toBe(true);
    expect(pdfContainsText(buf, "CRIT-001")).toBe(true);
  });

  test("include_critique without critique on brief is a no-op", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { include_critique: true, compress_pdf_streams: false });
    expect(pdfContainsText(buf, "Adversarial Critique")).toBe(false);
  });

  test("include_appendices renders Appendix headings", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { include_appendices: true, compress_pdf_streams: false });
    expect(pdfContainsText(buf, "Appendix A")).toBe(true);
    expect(pdfContainsText(buf, "Appendix B")).toBe(true);
    expect(pdfContainsText(buf, "Appendix C")).toBe(true);
  });

  test("include_sourcing_report renders the Sourcing Report heading", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { include_sourcing_report: true, compress_pdf_streams: false });
    expect(pdfContainsText(buf, "Sourcing Report")).toBe(true);
    expect(pdfContainsText(buf, "Policy: strict")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixed content (tables always appear)
// ---------------------------------------------------------------------------

describe("pdfRenderer — always-present content", () => {
  test("body always contains Options / Risks / Stakeholders / Sources headings", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { compress_pdf_streams: false });
    expect(pdfContainsText(buf, "Options")).toBe(true);
    expect(pdfContainsText(buf, "Risks")).toBe(true);
    expect(pdfContainsText(buf, "Stakeholders")).toBe(true);
    expect(pdfContainsText(buf, "Sources")).toBe(true);
  });

  test("options table shows OPT-A and its recommendation level", async () => {
    const buf = await pdfRenderer.render(makeBrief(), { compress_pdf_streams: false });
    expect(pdfContainsText(buf, "OPT-A")).toBe(true);
    expect(pdfContainsText(buf, "recommended")).toBe(true);
  });
});
