/**
 * Unit tests for the v0.7 `renderCritiqueInline` helper.
 *
 * The tests build synthetic `AdversarialCritiqueResult` values and
 * inspect the rendered text (ANSI stripped) for the load-bearing
 * lines a reader relies on.
 */

import { beforeEach, describe, expect, test } from "bun:test";

import { renderCritiqueInline, setColorEnabled } from "../../src/cli/output.ts";
import type { AdversarialCritiqueResult } from "../../src/agents/types.ts";

beforeEach(() => {
  setColorEnabled(false);
});

function makeResult(
  overrides: Partial<AdversarialCritiqueResult> = {}
): AdversarialCritiqueResult {
  return {
    critiques: [
      {
        id: "CRIT-001",
        category: "hidden-assumption",
        severity: "minor",
        target: { section_id: "intro" },
        steelmanned_position:
          "A steelmanned position that has enough words to pass the twenty-word minimum required by the parser at run time.",
        counter_evidence: {
          url: "https://reuters.com/x",
          title: "Reuters piece",
          accessed_at: "2026-08-15T00:00:00Z",
          excerpt: "…",
        },
        implication_if_true: "Something would shift.",
        suggested_revision: "Do X.",
      },
    ],
    critical_count: 0,
    material_count: 0,
    minor_count: 1,
    recommendation_robustness: "high",
    revised_recommendation_needed: false,
    steelmanned_alternative: null,
    ...overrides,
  };
}

describe("renderCritiqueInline — headline block", () => {
  test("prints the 'Adversarial Critique' heading", () => {
    const out = renderCritiqueInline(makeResult());
    expect(out).toContain("Adversarial Critique");
  });

  test("prints robustness, critique counts, and revision-needed line", () => {
    const out = renderCritiqueInline(makeResult());
    expect(out).toContain("Robustness:");
    expect(out).toContain("high");
    expect(out).toContain("Critiques:");
    expect(out).toContain("critical=0");
    expect(out).toContain("material=0");
    expect(out).toContain("minor=1");
    expect(out).toContain("Revision needed:");
  });

  test("prints the steelmanned alternative when supplied", () => {
    const out = renderCritiqueInline(
      makeResult({
        critical_count: 1,
        material_count: 0,
        minor_count: 0,
        revised_recommendation_needed: true,
        steelmanned_alternative: "Try the alternative course of action Z.",
      })
    );
    expect(out).toContain("Steelmanned alternative");
    expect(out).toContain("Try the alternative course of action Z.");
  });
});

describe("renderCritiqueInline — per-critique block", () => {
  test("each critique shows id, severity tag, and category", () => {
    const out = renderCritiqueInline(makeResult());
    expect(out).toContain("CRIT-001");
    expect(out).toContain("[minor]");
    expect(out).toContain("hidden-assumption");
  });

  test("target line describes the target fields set", () => {
    const out = renderCritiqueInline(
      makeResult({
        critiques: [
          {
            id: "CRIT-001",
            category: "risk-underestimated",
            severity: "material",
            target: {
              section_id: "s1",
              option_id: "OPT-A",
              risk_id: "RISK-001",
              stakeholder_name: "Alpha",
              finding_index: 2,
            },
            steelmanned_position:
              "A steelmanned position with enough words to pass the twenty-word minimum required by the parser at run time.",
            counter_evidence: {
              status: "SOURCE_MISSING",
              searched_for: "no source",
            },
            implication_if_true: "…",
            suggested_revision: "…",
          },
        ],
        material_count: 1,
        minor_count: 0,
        revised_recommendation_needed: false,
      })
    );
    expect(out).toContain("section=s1");
    expect(out).toContain("option=OPT-A");
    expect(out).toContain("risk=RISK-001");
    expect(out).toContain("stakeholder='Alpha'");
    expect(out).toContain("finding[2]");
  });

  test("SOURCE_MISSING counter_evidence renders the missing marker + searched_for", () => {
    const out = renderCritiqueInline(
      makeResult({
        critiques: [
          {
            id: "CRIT-001",
            category: "weak-source",
            severity: "minor",
            target: { section_id: "intro" },
            steelmanned_position:
              "A steelmanned position with enough words to pass the twenty-word minimum required by the parser at run time.",
            counter_evidence: {
              status: "SOURCE_MISSING",
              searched_for: "the missing source thing",
            },
            implication_if_true: "…",
            suggested_revision: "…",
          },
        ],
      })
    );
    expect(out).toContain("[SOURCE MISSING]");
    expect(out).toContain("the missing source thing");
  });
});
