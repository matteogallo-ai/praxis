/**
 * Renderers dispatcher tests (v0.7).
 *
 * The dispatcher's job is target normalisation + format
 * cross-check. It should:
 *   - accept "md" and "md-enhanced" as the same target
 *   - reject unknown targets with UnsupportedRenderTargetError
 *   - reject targets not declared in the format's output_targets[]
 *     with UnsupportedRenderTargetError
 *   - dispatch each valid target to the correct renderer
 */

import { describe, expect, test } from "bun:test";

import {
  normaliseRenderTarget,
  render,
  resolveTarget,
} from "../../src/renderers/index.ts";
import { UnsupportedRenderTargetError } from "../../src/renderers/errors.ts";
import type { Format } from "../../src/registry/schema.ts";
import type { BriefResult } from "../../src/orchestrator/orchestrator.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeFormat(outputTargets: ("md" | "docx" | "pdf")[]): Format {
  return {
    id: "test-format",
    name: "Test",
    version: "1.0.0",
    metadata: {
      author: "T",
      organization_style: "generic",
      language: "en",
      last_reviewed: "2026-08-17",
    },
    target_length: { pages: 1, words: 100 },
    sections: [
      {
        id: "s1",
        title: "S1",
        purpose: "…",
        max_length: { words: 100 },
        required_agents: ["scoping"] as Format["sections"][number]["required_agents"],
        tone_directives: "n/a",
      },
    ],
    sourcing_policy: "strict",
    style_guide: { voice: "n", sentence_structure: "s", forbidden_terms: [] },
    output_targets: outputTargets,
  };
}

function makeBrief(): BriefResult {
  return {
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
      recommended_option_id: "",
      rationale_for_recommendation: "…",
      counter_arguments_considered: [],
      unresolved_uncertainties: [],
    },
    synthesis: {
      sections: [
        {
          section_id: "s1",
          title: "S1",
          content_markdown: "body",
          word_count: 1,
          sources_cited: [],
          validation_issues: [],
        },
      ],
      total_word_count: 1,
      format_conformance: {
        target_words: 100,
        actual_words: 1,
        deviation_pct: -99,
        sections_over_length: [],
        forbidden_terms_found: [],
        failed_validation_rules: [],
      },
    },
    sourcing_report: {
      policy: "strict",
      total_items: 0,
      counts: { ok: 0, stale: 0, untrusted: 0, duplicated: 0, missing: 0 },
      warnings: [],
      missing_sources_count: 0,
    },
    generated_at: "2026-08-18T12:00:00.000Z",
    format_id: "test-format",
    question: "Q?",
    provider_name: "mock",
  };
}

// ---------------------------------------------------------------------------
// Target normalisation
// ---------------------------------------------------------------------------

describe("normaliseRenderTarget", () => {
  test("'md' maps to 'md-enhanced'", () => {
    expect(normaliseRenderTarget("md")).toBe("md-enhanced");
  });

  test("'md-enhanced' maps to 'md-enhanced'", () => {
    expect(normaliseRenderTarget("md-enhanced")).toBe("md-enhanced");
  });

  test("'docx' maps to 'docx'", () => {
    expect(normaliseRenderTarget("docx")).toBe("docx");
  });

  test("'pdf' maps to 'pdf'", () => {
    expect(normaliseRenderTarget("pdf")).toBe("pdf");
  });

  test("unknown target returns null", () => {
    expect(normaliseRenderTarget("epub")).toBeNull();
    expect(normaliseRenderTarget("")).toBeNull();
    expect(normaliseRenderTarget("html")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveTarget (dispatcher validation)
// ---------------------------------------------------------------------------

describe("resolveTarget — format cross-check", () => {
  test("format with 'md' allows md-enhanced", () => {
    const fmt = makeFormat(["md"]);
    expect(resolveTarget("md", fmt)).toBe("md-enhanced");
    expect(resolveTarget("md-enhanced", fmt)).toBe("md-enhanced");
  });

  test("format with 'pdf' allows pdf", () => {
    const fmt = makeFormat(["pdf"]);
    expect(resolveTarget("pdf", fmt)).toBe("pdf");
  });

  test("format with 'docx' allows docx", () => {
    const fmt = makeFormat(["docx"]);
    expect(resolveTarget("docx", fmt)).toBe("docx");
  });

  test("format without 'pdf' rejects pdf", () => {
    const fmt = makeFormat(["md"]);
    let caught: unknown;
    try { resolveTarget("pdf", fmt); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnsupportedRenderTargetError);
  });

  test("format without 'docx' rejects docx", () => {
    const fmt = makeFormat(["md", "pdf"]);
    expect(() => resolveTarget("docx", fmt)).toThrow(UnsupportedRenderTargetError);
  });

  test("unknown target rejected regardless of format", () => {
    const fmt = makeFormat(["md", "pdf", "docx"]);
    let caught: unknown;
    try { resolveTarget("epub", fmt); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnsupportedRenderTargetError);
    if (caught instanceof UnsupportedRenderTargetError) {
      expect(caught.formatId).toBe("test-format");
      expect(caught.allowedTargets).toBeDefined();
    }
  });

  test("format with all three targets allows every renderer", () => {
    const fmt = makeFormat(["md", "docx", "pdf"]);
    expect(resolveTarget("md-enhanced", fmt)).toBe("md-enhanced");
    expect(resolveTarget("docx", fmt)).toBe("docx");
    expect(resolveTarget("pdf", fmt)).toBe("pdf");
  });
});

// ---------------------------------------------------------------------------
// render() — end-to-end dispatch
// ---------------------------------------------------------------------------

describe("render — full dispatch", () => {
  test("dispatches to md-enhanced renderer when target='md'", async () => {
    const fmt = makeFormat(["md"]);
    const buf = await render(makeBrief(), "md", fmt);
    const text = buf.toString("utf-8");
    expect(text.startsWith("---\n")).toBe(true);
    expect(text).toContain("# Q?");
  });

  test("dispatches to docx renderer when target='docx'", async () => {
    const fmt = makeFormat(["docx"]);
    const buf = await render(makeBrief(), "docx", fmt);
    // ZIP magic PK\x03\x04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  test("dispatches to pdf renderer when target='pdf'", async () => {
    const fmt = makeFormat(["pdf"]);
    const buf = await render(makeBrief(), "pdf", fmt, { compress_pdf_streams: false });
    expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  });

  test("throws UnsupportedRenderTargetError when the format forbids the target", async () => {
    const fmt = makeFormat(["md"]);
    let caught: unknown;
    try {
      await render(makeBrief(), "pdf", fmt);
    } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(UnsupportedRenderTargetError);
    if (caught instanceof UnsupportedRenderTargetError) {
      expect(caught.message).toContain("test-format");
      expect(caught.message).toContain("pdf");
    }
  });
});
