/**
 * Unit tests for the CLI output helpers introduced or extended in
 * v0.6, mainly `renderFullBrief` (YAML front-matter + Markdown
 * assembly). Colour is disabled globally so assertions can inspect
 * raw text.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { renderFullBrief, setColorEnabled } from "../../src/cli/output.ts";
import type { BriefResult } from "../../src/orchestrator/orchestrator.ts";

beforeEach(() => {
  setColorEnabled(false);
});

const SOURCE = {
  url: "https://reuters.com/example",
  title: "Example",
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
    research: { findings: [], open_questions: [], search_queries_used: [] },
    stakeholders: {
      stakeholders: [],
      key_dynamics: [],
      blind_spots: [],
      coverage_confidence: "medium",
    },
    risks: {
      risks: [],
      aggregated_risk_score: { overall: "medium", by_category: {} },
      top_3_priorities: [],
      unresolved_uncertainties: [],
    },
    options: {
      options: [],
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
          content_markdown: "The intro paragraph body.",
          word_count: 4,
          sources_cited: [SOURCE],
          validation_issues: [],
        },
        {
          section_id: "body",
          title: "Body",
          content_markdown: "The body paragraph body.",
          word_count: 4,
          sources_cited: [],
          validation_issues: [],
        },
      ],
      total_word_count: 8,
      format_conformance: {
        target_words: 800,
        actual_words: 8,
        deviation_pct: -99,
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

describe("renderFullBrief — YAML front-matter", () => {
  test("starts with a YAML front-matter block", () => {
    const md = renderFullBrief(makeBrief());
    expect(md.startsWith("---\n")).toBe(true);
    const closeIdx = md.indexOf("\n---\n", 4);
    expect(closeIdx).toBeGreaterThan(0);
  });

  test("front-matter includes every audit field", () => {
    const md = renderFullBrief(makeBrief());
    expect(md).toContain("question: \"Should we enter the German market?\"");
    expect(md).toContain("format: \"executive-pre-read\"");
    expect(md).toContain("provider: \"mock\"");
    expect(md).toContain("generated_at: \"2026-08-18T12:00:00.000Z\"");
    expect(md).toContain("recommended_option: \"OPT-A\"");
    expect(md).toContain("aggregated_risk: \"medium\"");
    expect(md).toContain("total_word_count: 8");
    expect(md).toContain("target_word_count: 800");
    expect(md).toContain("word_deviation_pct: -99");
  });

  test("front-matter escapes embedded double quotes in the question", () => {
    const md = renderFullBrief(makeBrief({ question: `He said "hi"` }));
    expect(md).toContain(`question: "He said \\"hi\\""`);
  });

  test("sourcing_summary is a single quoted string with all count categories", () => {
    const md = renderFullBrief(makeBrief());
    expect(md).toContain('sourcing_summary: "total=5 ok=5 stale=0 untrusted=0 duplicated=0 missing=0"');
  });
});

describe("renderFullBrief — Markdown body", () => {
  test("question is rendered as H1", () => {
    const md = renderFullBrief(makeBrief());
    expect(md).toContain("# Should we enter the German market?");
  });

  test("sections appear as H2 in declared order", () => {
    const md = renderFullBrief(makeBrief());
    const introIdx = md.indexOf("## Intro");
    const bodyIdx = md.indexOf("## Body");
    expect(introIdx).toBeGreaterThan(0);
    expect(bodyIdx).toBeGreaterThan(introIdx);
  });

  test("cited sources appear as a bullet list after the section", () => {
    const md = renderFullBrief(makeBrief());
    expect(md).toContain("**Sources:**");
    expect(md).toContain(`[Example](${SOURCE.url})`);
  });

  test("sections without sources omit the Sources heading", () => {
    const md = renderFullBrief(makeBrief());
    // The 'body' section has no sources — the H2 "Body" and its content
    // should not be followed by "**Sources:**" before the next H2 (which
    // does not exist here — it's the last section).
    const bodyIdx = md.indexOf("## Body");
    const tailAfterBody = md.slice(bodyIdx);
    expect(tailAfterBody).not.toContain("**Sources:**");
  });

  test("validation_issues render as an HTML comment block", () => {
    const brief = makeBrief();
    brief.synthesis.sections[0]!.validation_issues = ["issue one", "issue two"];
    const md = renderFullBrief(brief);
    expect(md).toContain("<!-- Validation issues:");
    expect(md).toContain("issue one");
    expect(md).toContain("issue two");
    expect(md).toContain("-->");
  });

  test("headings with newlines are collapsed to a single line", () => {
    const md = renderFullBrief(
      makeBrief({ question: "A\nweird\nquestion" })
    );
    expect(md).toContain("# A weird question");
  });

  test("source titles containing brackets are markdown-escaped", () => {
    const brief = makeBrief();
    brief.synthesis.sections[0]!.sources_cited = [
      { ...SOURCE, title: "Title with [brackets]" },
    ];
    const md = renderFullBrief(brief);
    expect(md).toContain("[Title with \\[brackets\\]](");
  });
});

describe("renderFullBrief — ANSI freedom", () => {
  test("the output contains no ANSI escape codes", () => {
    setColorEnabled(true); // even if colour is on globally
    const md = renderFullBrief(makeBrief());
    setColorEnabled(false);
    expect(md.includes("\x1b[")).toBe(false);
  });
});
