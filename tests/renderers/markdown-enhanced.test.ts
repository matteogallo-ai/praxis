/**
 * Unit tests for the enhanced Markdown renderer (v0.7).
 *
 * The tests build synthetic `BriefResult` / `BriefWithCritiqueResult`
 * fixtures rather than driving the full pipeline — they exercise the
 * renderer in isolation.
 */

import { describe, expect, test } from "bun:test";

import {
  markdownEnhancedRenderer,
  renderMarkdownEnhanced,
} from "../../src/renderers/markdown-enhanced.ts";
import type {
  BriefResult,
  BriefWithCritiqueResult,
} from "../../src/orchestrator/orchestrator.ts";

const SRC_A = {
  url: "https://reuters.com/a",
  title: "Reuters article A",
  accessed_at: "2026-08-15T00:00:00Z",
  excerpt: "…",
};

const SRC_B = {
  url: "https://www.bloomberg.com/b",
  title: "Bloomberg piece B",
  accessed_at: "2026-08-15T00:00:00Z",
  excerpt: "…",
};

const SRC_C = {
  url: "https://reuters.com/c",
  title: "Reuters article C",
  accessed_at: "2026-08-15T00:00:00Z",
  excerpt: "…",
};

function makeBrief(overrides: Partial<BriefResult> = {}): BriefResult {
  const base: BriefResult = {
    scoping: {
      reformulated_question: "R?",
      hidden_questions: [],
      scope_boundaries: [],
      assumptions_to_validate: [],
    },
    research: {
      findings: [
        { claim: "c1", supporting_evidence: "e1", source: SRC_A },
        { claim: "c2", supporting_evidence: "e2", source: SRC_B },
      ],
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
          position_evidence: SRC_A,
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
          likelihood_evidence: SRC_A,
          impact_evidence: SRC_C,
          affected_stakeholders: ["Alpha"],
          timeframe: "short-term",
          mitigations: ["Do X"],
          residual_risk_after_mitigation: "low",
        },
      ],
      aggregated_risk_score: {
        overall: "medium",
        by_category: { strategic: "medium" },
      },
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
          supporting_evidence: SRC_B,
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
          content_markdown: "The intro text with a source.",
          word_count: 6,
          sources_cited: [SRC_A],
          validation_issues: [],
        },
        {
          section_id: "body",
          title: "Body",
          content_markdown: "The body paragraph.",
          word_count: 3,
          sources_cited: [SRC_B],
          validation_issues: [],
        },
      ],
      total_word_count: 9,
      format_conformance: {
        target_words: 800,
        actual_words: 9,
        deviation_pct: -98.9,
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
    format_id: "executive-pre-read",
    question: "Should we enter the German market?",
    provider_name: "mock",
  };
  return { ...base, ...overrides };
}

function makeBriefWithCritique(): BriefWithCritiqueResult {
  const base = makeBrief();
  return {
    ...base,
    adversarial: {
      critiques: [
        {
          id: "CRIT-001",
          category: "hidden-assumption",
          severity: "critical",
          target: { section_id: "intro" },
          steelmanned_position:
            "This is a steelmanned position with enough words to pass the minimum length check and to look believable when rendered inside the enhanced Markdown critique section.",
          counter_evidence: {
            url: "https://ft.com/critique-source",
            title: "FT critique piece",
            accessed_at: "2026-08-15T00:00:00Z",
            excerpt: "…",
          },
          implication_if_true: "The whole thing would flip.",
          suggested_revision: "Rework the intro.",
        },
        {
          id: "CRIT-002",
          category: "weak-source",
          severity: "minor",
          target: { finding_index: 0 },
          steelmanned_position:
            "Another steelmanned position that has enough words to pass the minimum length check for the parser and to render meaningfully in the output.",
          counter_evidence: { status: "SOURCE_MISSING", searched_for: "additional sources" },
          implication_if_true: "Might soften the claim.",
          suggested_revision: "Add a hedge.",
        },
      ],
      critical_count: 1,
      material_count: 0,
      minor_count: 1,
      recommendation_robustness: "medium",
      revised_recommendation_needed: true,
      steelmanned_alternative: "Consider the alternative course of action X.",
    },
  };
}

// ---------------------------------------------------------------------------
// YAML front-matter
// ---------------------------------------------------------------------------

describe("renderMarkdownEnhanced — front-matter", () => {
  test("YAML front-matter starts the document", () => {
    const md = renderMarkdownEnhanced(makeBrief());
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("question: \"Should we enter the German market?\"");
    expect(md).toContain("format: \"executive-pre-read\"");
    expect(md).toContain("provider: \"mock\"");
    expect(md).toContain("recommended_option: \"OPT-A\"");
    expect(md).toContain("sourcing_summary: \"total=5");
  });

  test("front-matter escapes embedded quotes in the question", () => {
    const md = renderMarkdownEnhanced(makeBrief({ question: `He said "hi"` }));
    expect(md).toContain(`question: "He said \\"hi\\""`);
  });

  test("front-matter includes critique_summary when critique is attached", () => {
    const md = renderMarkdownEnhanced(makeBriefWithCritique());
    expect(md).toContain("critique_summary:");
    expect(md).toContain("critical=1");
    expect(md).toContain("material=0");
    expect(md).toContain("robustness=medium");
    expect(md).toContain("revised_needed=true");
  });

  test("front-matter omits critique_summary on a plain brief", () => {
    const md = renderMarkdownEnhanced(makeBrief());
    expect(md).not.toContain("critique_summary:");
  });
});

// ---------------------------------------------------------------------------
// TOC
// ---------------------------------------------------------------------------

describe("renderMarkdownEnhanced — TOC", () => {
  test("without include_toc, no TOC is emitted", () => {
    const md = renderMarkdownEnhanced(makeBrief());
    expect(md).not.toContain("## Table of Contents");
  });

  test("with include_toc, TOC lists every synthesis section by title", () => {
    const md = renderMarkdownEnhanced(makeBrief(), { include_toc: true });
    expect(md).toContain("## Table of Contents");
    expect(md).toContain("- [Intro](#intro)");
    expect(md).toContain("- [Body](#body)");
    expect(md).toContain("- [Sources](#sources)");
  });

  test("TOC includes the critique section when include_critique is set on a briefWithCritique", () => {
    const md = renderMarkdownEnhanced(makeBriefWithCritique(), {
      include_toc: true,
      include_critique: true,
    });
    expect(md).toContain("- [Adversarial Critique](#adversarial-critique)");
  });

  test("TOC includes appendix entries when include_appendices is set", () => {
    const md = renderMarkdownEnhanced(makeBrief(), {
      include_toc: true,
      include_appendices: true,
    });
    expect(md).toContain("- [Appendix A — Findings](#appendix-a--findings)");
    expect(md).toContain("- [Appendix B — Stakeholders](#appendix-b--stakeholders)");
    expect(md).toContain("- [Appendix C — Risk Register](#appendix-c--risk-register)");
  });
});

// ---------------------------------------------------------------------------
// Sections + sources
// ---------------------------------------------------------------------------

describe("renderMarkdownEnhanced — sections and sources", () => {
  test("every synthesis section is rendered in order as H2", () => {
    const md = renderMarkdownEnhanced(makeBrief());
    const introIdx = md.indexOf("## Intro");
    const bodyIdx = md.indexOf("## Body");
    expect(introIdx).toBeGreaterThan(0);
    expect(bodyIdx).toBeGreaterThan(introIdx);
  });

  test("per-section Sources block includes the cited URL", () => {
    const md = renderMarkdownEnhanced(makeBrief());
    expect(md).toContain(`[Reuters article A](${SRC_A.url})`);
    expect(md).toContain(`[Bloomberg piece B](${SRC_B.url})`);
  });

  test("validation_issues render as an HTML comment block", () => {
    const brief = makeBrief();
    brief.synthesis.sections[0]!.validation_issues = ["issue one", "issue two"];
    const md = renderMarkdownEnhanced(brief);
    expect(md).toContain("<!-- Validation issues:");
    expect(md).toContain("issue one");
    expect(md).toContain("issue two");
    expect(md).toContain("-->");
  });
});

// ---------------------------------------------------------------------------
// Sources section (footer)
// ---------------------------------------------------------------------------

describe("renderMarkdownEnhanced — Sources section (dedup + domain grouping)", () => {
  test("emits a Sources H2 grouped by domain in alphabetical order", () => {
    const md = renderMarkdownEnhanced(makeBrief());
    const srcIdx = md.indexOf("## Sources");
    expect(srcIdx).toBeGreaterThan(0);
    const bloombergIdx = md.indexOf("### www.bloomberg.com", srcIdx);
    const reutersIdx = md.indexOf("### reuters.com", srcIdx);
    expect(bloombergIdx).toBeGreaterThan(srcIdx);
    expect(reutersIdx).toBeGreaterThan(srcIdx);
    // Alphabetical: 'r' < 'w' → reuters.com comes BEFORE www.bloomberg.com.
    expect(reutersIdx).toBeLessThan(bloombergIdx);
  });

  test("de-duplicates the same URL cited across multiple artefacts", () => {
    // SRC_A appears as research finding, stakeholder evidence, and
    // risk likelihood evidence — the Sources section must list it
    // exactly once.
    const md = renderMarkdownEnhanced(makeBrief());
    const occurrences = md
      .split("## Sources")
      .slice(1)
      .join("## Sources")
      .split(SRC_A.url).length - 1;
    expect(occurrences).toBe(1);
  });

  test("includes the critique's counter-evidence in Sources when critique attached", () => {
    const md = renderMarkdownEnhanced(makeBriefWithCritique());
    const srcIdx = md.indexOf("## Sources");
    const tail = md.slice(srcIdx);
    expect(tail).toContain("https://ft.com/critique-source");
  });

  test("SOURCE_MISSING entries do NOT appear in the Sources footer", () => {
    const md = renderMarkdownEnhanced(makeBriefWithCritique());
    const srcIdx = md.indexOf("## Sources");
    const tail = md.slice(srcIdx);
    // The critique with SOURCE_MISSING must not create a phantom link.
    expect(tail).not.toContain("SOURCE_MISSING");
  });
});

// ---------------------------------------------------------------------------
// Critique section
// ---------------------------------------------------------------------------

describe("renderMarkdownEnhanced — Critique section", () => {
  test("without include_critique flag, no critique section (even if attached)", () => {
    const md = renderMarkdownEnhanced(makeBriefWithCritique());
    expect(md).not.toContain("## Adversarial Critique");
  });

  test("with include_critique on a plain brief, no critique section", () => {
    const md = renderMarkdownEnhanced(makeBrief(), { include_critique: true });
    expect(md).not.toContain("## Adversarial Critique");
  });

  test("with include_critique on briefWithCritique, section renders with every critique", () => {
    const md = renderMarkdownEnhanced(makeBriefWithCritique(), {
      include_critique: true,
    });
    expect(md).toContain("## Adversarial Critique");
    expect(md).toContain("### CRIT-001 — hidden-assumption (critical)");
    expect(md).toContain("### CRIT-002 — weak-source (minor)");
    expect(md).toContain("**Robustness:** medium");
    expect(md).toContain("**Steelmanned alternative to the current recommendation:** Consider the alternative course of action X.");
  });

  test("critique with SOURCE_MISSING counter_evidence renders SOURCE_MISSING marker", () => {
    const md = renderMarkdownEnhanced(makeBriefWithCritique(), {
      include_critique: true,
    });
    expect(md).toContain("_SOURCE_MISSING_ — searched for: additional sources");
  });
});

// ---------------------------------------------------------------------------
// Appendices
// ---------------------------------------------------------------------------

describe("renderMarkdownEnhanced — Appendices", () => {
  test("without include_appendices, no appendix sections", () => {
    const md = renderMarkdownEnhanced(makeBrief());
    expect(md).not.toContain("## Appendix A");
  });

  test("with include_appendices, all three appendices render", () => {
    const md = renderMarkdownEnhanced(makeBrief(), { include_appendices: true });
    expect(md).toContain("## Appendix A — Findings");
    expect(md).toContain("## Appendix B — Stakeholders");
    expect(md).toContain("## Appendix C — Risk Register");
    // Stakeholder table header.
    expect(md).toContain("| Name | Category | Position | Power | Priority |");
    // Risk register table header.
    expect(md).toContain("| ID | Category | Likelihood | Impact | Timeframe |");
    expect(md).toContain("| RISK-001 | strategic | medium | moderate | short-term |");
  });
});

// ---------------------------------------------------------------------------
// Renderer wrapper
// ---------------------------------------------------------------------------

describe("markdownEnhancedRenderer", () => {
  test("target is 'md-enhanced'", () => {
    expect(markdownEnhancedRenderer.target).toBe("md-enhanced");
  });

  test("render() returns a UTF-8 Buffer", async () => {
    const buf = await markdownEnhancedRenderer.render(makeBrief());
    expect(Buffer.isBuffer(buf)).toBe(true);
    const decoded = buf.toString("utf-8");
    expect(decoded).toContain("# Should we enter the German market?");
  });
});
