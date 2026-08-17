import { describe, expect, test } from "bun:test";

import {
  validateSourcing,
  validateStakeholderSourcing,
} from "../../src/sourcing/validator.ts";
import { SourcingValidationError } from "../../src/sourcing/errors.ts";
import type {
  ResearchResult,
  StakeholderMapResult,
  Stakeholder,
} from "../../src/agents/types.ts";

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
    expect(report.total_items).toBe(2);
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
    const w = e.report.warnings[0]!;
    expect(w.kind).toBe("missing_source");
    if (w.kind === "missing_source") {
      expect(w.finding_index).toBe(1);
      expect(w.searched_for).toBe("effect size of X on Y");
    }
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
    expect(report.total_items).toBe(0);
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
    expect(report.total_items).toBe(4);
    expect(report.missing_sources_count).toBe(2);
    const indices = report.warnings.map((w) =>
      w.kind === "missing_source" ? w.finding_index : -1
    );
    expect(indices).toEqual([1, 3]);
    const first = report.warnings[0]!;
    if (first.kind === "missing_source") {
      expect(first.searched_for).toBe("what is the CAGR of X");
    }
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

// ---------------------------------------------------------------------------
// v0.4 — validateStakeholderSourcing
// ---------------------------------------------------------------------------

function stakeholder(overrides: Partial<Stakeholder> = {}): Stakeholder {
  return {
    name: "Actor",
    category: "influencer",
    interest: "Owns the flow.",
    position: "neutral",
    position_evidence: {
      url: "https://a.example",
      title: "A",
      accessed_at: "2026-08-17T00:00:00Z",
      excerpt: "…",
    },
    power: "medium",
    priority: "important",
    engagement_notes: "Engage carefully.",
    ...overrides,
  };
}

function stakeholderMap(entries: Stakeholder[]): StakeholderMapResult {
  return {
    stakeholders: entries,
    key_dynamics: ["a", "b", "c"],
    blind_spots: [],
    coverage_confidence: "medium",
  };
}

describe("validateStakeholderSourcing — strict", () => {
  test("returns clean report when every position_evidence is sourced", () => {
    const result = stakeholderMap([
      stakeholder({ name: "Actor 1" }),
      stakeholder({ name: "Actor 2" }),
    ]);
    const report = validateStakeholderSourcing(result, "strict");
    expect(report.total_items).toBe(2);
    expect(report.missing_sources_count).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(report.policy).toBe("strict");
  });

  test("throws SourcingValidationError when a single position lacks evidence", () => {
    const result = stakeholderMap([
      stakeholder({ name: "Actor 1" }),
      stakeholder({
        name: "Anonymous Group",
        position_evidence: {
          status: "SOURCE_MISSING",
          searched_for: "public statement by anonymous group",
        },
      }),
    ]);
    let caught: unknown;
    try {
      validateStakeholderSourcing(result, "strict");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SourcingValidationError);
    const e = caught as SourcingValidationError;
    expect(e.report.missing_sources_count).toBe(1);
    const w = e.report.warnings[0]!;
    expect(w.kind).toBe("missing_stakeholder_evidence");
    if (w.kind === "missing_stakeholder_evidence") {
      expect(w.stakeholder_index).toBe(1);
      expect(w.stakeholder_name).toBe("Anonymous Group");
      expect(w.searched_for).toBe("public statement by anonymous group");
    }
  });
});

describe("validateStakeholderSourcing — permissive", () => {
  test("accepts missing evidence and reports warnings", () => {
    const result = stakeholderMap([
      stakeholder({ name: "A" }),
      stakeholder({
        name: "B",
        position_evidence: { status: "SOURCE_MISSING", searched_for: "q1" },
      }),
      stakeholder({ name: "C" }),
      stakeholder({
        name: "D",
        position_evidence: { status: "SOURCE_MISSING", searched_for: "q2" },
      }),
    ]);
    const report = validateStakeholderSourcing(result, "permissive");
    expect(report.policy).toBe("permissive");
    expect(report.total_items).toBe(4);
    expect(report.missing_sources_count).toBe(2);
    const names = report.warnings.map((w) =>
      w.kind === "missing_stakeholder_evidence" ? w.stakeholder_name : ""
    );
    expect(names).toEqual(["B", "D"]);
  });

  test("clean report when nothing is missing", () => {
    const result = stakeholderMap([stakeholder({ name: "A" })]);
    const report = validateStakeholderSourcing(result, "permissive");
    expect(report.missing_sources_count).toBe(0);
    expect(report.warnings).toEqual([]);
  });
});
