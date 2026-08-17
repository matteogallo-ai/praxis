import { describe, expect, test } from "bun:test";

import { validateSourcing } from "../../src/sourcing/validator.ts";
import { SourcingValidationError } from "../../src/sourcing/errors.ts";
import type { ResearchResult } from "../../src/agents/types.ts";

function sourced(url: string, title: string, excerpt = "…"): ResearchResult["findings"][number] {
  return {
    claim: "some claim",
    supporting_evidence: "supporting text",
    source: {
      url,
      title,
      accessed_at: "2026-08-17T12:00:00Z",
      excerpt,
    },
  };
}

function missing(searchedFor: string): ResearchResult["findings"][number] {
  return {
    claim: "some claim",
    supporting_evidence: "supporting text",
    source: { status: "SOURCE_MISSING", searched_for: searchedFor },
  };
}

describe("validateSourcing — strict", () => {
  test("returns a clean report when every finding is sourced", () => {
    const result: ResearchResult = {
      findings: [
        sourced("https://a.example", "A"),
        sourced("https://b.example", "B"),
      ],
      open_questions: [],
      search_queries_used: [],
    };
    const report = validateSourcing(result, "strict");
    expect(report.total_findings).toBe(2);
    expect(report.missing_sources_count).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(report.policy).toBe("strict");
  });

  test("throws SourcingValidationError when a single finding is missing", () => {
    const result: ResearchResult = {
      findings: [
        sourced("https://a.example", "A"),
        missing("effect size of X on Y"),
      ],
      open_questions: [],
      search_queries_used: [],
    };
    let caught: unknown;
    try {
      validateSourcing(result, "strict");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SourcingValidationError);
    const e = caught as SourcingValidationError;
    expect(e.report.missing_sources_count).toBe(1);
    expect(e.report.warnings[0]!.finding_index).toBe(1);
    expect(e.report.warnings[0]!.searched_for).toBe("effect size of X on Y");
  });

  test("throws when every finding is missing", () => {
    const result: ResearchResult = {
      findings: [missing("q1"), missing("q2"), missing("q3")],
      open_questions: [],
      search_queries_used: [],
    };
    let caught: unknown;
    try {
      validateSourcing(result, "strict");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SourcingValidationError);
    expect((caught as SourcingValidationError).report.missing_sources_count).toBe(3);
  });

  test("passes on an empty findings list", () => {
    const result: ResearchResult = {
      findings: [],
      open_questions: ["everything is open"],
      search_queries_used: [],
    };
    const report = validateSourcing(result, "strict");
    expect(report.total_findings).toBe(0);
    expect(report.missing_sources_count).toBe(0);
  });
});

describe("validateSourcing — permissive", () => {
  test("does not throw when findings are missing; returns warnings", () => {
    const result: ResearchResult = {
      findings: [
        sourced("https://a.example", "A"),
        missing("what is the CAGR of X"),
        sourced("https://c.example", "C"),
        missing("median deal size"),
      ],
      open_questions: [],
      search_queries_used: [],
    };
    const report = validateSourcing(result, "permissive");
    expect(report.policy).toBe("permissive");
    expect(report.total_findings).toBe(4);
    expect(report.missing_sources_count).toBe(2);
    expect(report.warnings.map((w) => w.finding_index)).toEqual([1, 3]);
    expect(report.warnings[0]!.searched_for).toBe("what is the CAGR of X");
  });

  test("returns clean report when nothing is missing", () => {
    const result: ResearchResult = {
      findings: [sourced("https://a.example", "A")],
      open_questions: [],
      search_queries_used: [],
    };
    const report = validateSourcing(result, "permissive");
    expect(report.missing_sources_count).toBe(0);
    expect(report.warnings).toEqual([]);
  });
});
