import { describe, expect, test } from "bun:test";

import {
  validateRiskSourcing,
  validateSourcing,
  validateStakeholderSourcing,
} from "../../src/sourcing/validator.ts";
import {
  SourcingValidationError,
  StaleSourceError,
  UntrustedDomainError,
} from "../../src/sourcing/errors.ts";
import { InMemorySourcingAccumulator } from "../../src/sourcing/dedupe.ts";
import type {
  ResearchResult,
  StakeholderMapResult,
  Stakeholder,
  Risk,
  RiskAnalysisResult,
} from "../../src/agents/types.ts";
import type { SourcingRules } from "../../src/sourcing/types.ts";

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

// ---------------------------------------------------------------------------
// v0.5 — hardened rules (freshness, domain trust, dedupe) + Risk sourcing.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-08-18T00:00:00Z");

/** A source published on `dateIso`, retrieved at NOW: freshness is the publication's. */
function sourcedAt(dateIso: string, url = "https://reuters.com/x"): ResearchResult["findings"][number] {
  return {
    claim: "some claim",
    supporting_evidence: "supporting text",
    source: {
      url,
      title: "T",
      accessed_at: NOW.toISOString(),
      published_at: dateIso,
      excerpt: "…",
    },
  };
}

function retrievedOnly(accessedIso: string): ResearchResult["findings"][number] {
  return {
    claim: "some claim",
    supporting_evidence: "supporting text",
    source: { url: "https://reuters.com/y", title: "T", accessed_at: accessedIso, excerpt: "…" },
  };
}

function research(findings: ResearchResult["findings"]): ResearchResult {
  return { findings, open_questions: [], search_queries_used: [] };
}

describe("validateSourcing — freshness rule", () => {
  const rules: SourcingRules = {
    freshness: { max_source_age_days: 730, warn_after_days: 365 },
  };

  test("freshness is the publication date's: retrieved today, published long ago, is stale", () => {
    const r = validateSourcing(research([sourcedAt("2010-01-01")]), "permissive", { rules, now: NOW });
    expect(r.counts.stale).toBe(1);
    expect(r.warnings[0]).toEqual(expect.objectContaining({ kind: "stale_source", published_at: "2010-01-01" }));
  });

  test("without a publication date, freshness is unknown: counted apart, never fresh, never stale", () => {
    // Retrieval time says nothing about the page's age, old or recent.
    for (const accessed of ["2026-08-18T00:00:00Z", "2000-01-01T00:00:00Z"]) {
      const r = validateSourcing(research([retrievedOnly(accessed)]), "strict", { rules, now: NOW });
      expect(r.warnings).toEqual([]);
      expect(r.counts.stale).toBe(0);
      expect(r.freshness_unknown).toBe(1);
    }
  });

  test("a strict failure's report still counts the sources of unknown freshness", () => {
    let caught: unknown;
    try {
      validateSourcing(research([retrievedOnly(NOW.toISOString()), missing("q")]), "strict", { rules, now: NOW });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SourcingValidationError);
    expect((caught as SourcingValidationError).report.freshness_unknown).toBe(1);
  });

  test("a dated source is not counted as unknown", () => {
    const r = validateSourcing(research([sourcedAt("2026-08-01")]), "permissive", { rules, now: NOW });
    expect(r.freshness_unknown).toBe(0);
  });

  test("emits a stale_source warning under permissive when past max", () => {
    const r = validateSourcing(
      research([sourcedAt("2020-01-01T00:00:00Z")]),
      "permissive",
      { rules, now: NOW }
    );
    expect(r.warnings).toHaveLength(1);
    const w = r.warnings[0]!;
    expect(w.kind).toBe("stale_source");
    if (w.kind === "stale_source") {
      expect(w.exceeds_max).toBe(true);
      expect(w.age_days).toBeGreaterThan(730);
    }
    expect(r.counts.stale).toBe(1);
  });

  test("emits a stale_source warning (non-blocking) between warn and max", () => {
    const r = validateSourcing(
      research([sourcedAt("2025-01-01T00:00:00Z")]),
      "permissive",
      { rules, now: NOW }
    );
    expect(r.warnings).toHaveLength(1);
    const w = r.warnings[0]!;
    if (w.kind === "stale_source") {
      expect(w.exceeds_max).toBe(false);
    }
    // Stale bucket categorisation still applies (non-blocking though).
    expect(r.counts.stale).toBe(1);
  });

  test("does NOT throw under strict when age is only past warn (soft warning)", () => {
    expect(() =>
      validateSourcing(
        research([sourcedAt("2025-06-01T00:00:00Z")]),
        "strict",
        { rules, now: NOW }
      )
    ).not.toThrow();
  });

  test("throws StaleSourceError under strict when age exceeds max", () => {
    let caught: unknown;
    try {
      validateSourcing(
        research([sourcedAt("2020-01-01T00:00:00Z")]),
        "strict",
        { rules, now: NOW }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StaleSourceError);
    const e = caught as StaleSourceError;
    expect(e.maxAgeDays).toBe(730);
    expect(e.ageDays).toBeGreaterThan(730);
  });

  test("fresh sources pass cleanly", () => {
    const r = validateSourcing(
      research([sourcedAt("2026-08-01T00:00:00Z")]),
      "strict",
      { rules, now: NOW }
    );
    expect(r.warnings).toEqual([]);
    expect(r.counts.ok).toBe(1);
  });
});

describe("validateSourcing — domain trust rule", () => {
  const rules: SourcingRules = {
    domain_trust: {
      mode: "reputation-only",
      reputation_tiers: {
        tier_1: ["reuters.com"],
        tier_2: ["hbr.org"],
        tier_3: ["wikipedia.org"],
        min_tier: 2,
      },
    },
  };

  test("emits an untrusted_domain warning under permissive", () => {
    const r = validateSourcing(
      research([sourcedAt("2026-08-01T00:00:00Z", "https://blogspot.com/x")]),
      "permissive",
      { rules, now: NOW }
    );
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]!.kind).toBe("untrusted_domain");
    expect(r.counts.untrusted).toBe(1);
  });

  test("throws UntrustedDomainError under strict", () => {
    let caught: unknown;
    try {
      validateSourcing(
        research([sourcedAt("2026-08-01T00:00:00Z", "https://medium.com/x")]),
        "strict",
        { rules, now: NOW }
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UntrustedDomainError);
  });

  test("trusted-tier source passes", () => {
    const r = validateSourcing(
      research([sourcedAt("2026-08-01T00:00:00Z", "https://reuters.com/x")]),
      "strict",
      { rules, now: NOW }
    );
    expect(r.warnings).toEqual([]);
  });
});

describe("validateSourcing — cross-agent dedupe", () => {
  const rules: SourcingRules = {
    dedupe: { cross_agent: true, similarity_threshold: 0.85 },
  };

  test("emits a duplicate_source warning when the same URL appears in two agents", () => {
    const acc = new InMemorySourcingAccumulator(rules.dedupe!);
    validateSourcing(
      research([sourcedAt("2026-08-01T00:00:00Z", "https://reuters.com/x")]),
      "permissive",
      { rules, now: NOW, accumulator: acc }
    );
    const stakeholderReport = validateStakeholderSourcing(
      {
        stakeholders: [
          stakeholder({
            name: "A",
            position_evidence: {
              url: "https://reuters.com/x",
              title: "T",
              accessed_at: "2026-08-01T00:00:00Z",
              excerpt: "…",
            },
          }),
        ],
        key_dynamics: ["a", "b", "c"],
        blind_spots: [],
        coverage_confidence: "medium",
      },
      "permissive",
      { rules, now: NOW, accumulator: acc }
    );
    expect(stakeholderReport.warnings).toHaveLength(1);
    expect(stakeholderReport.warnings[0]!.kind).toBe("duplicate_source");
    expect(stakeholderReport.counts.duplicated).toBe(1);
  });

  test("does not flag duplicates within a single agent", () => {
    const acc = new InMemorySourcingAccumulator(rules.dedupe!);
    const r = validateSourcing(
      research([
        sourcedAt("2026-08-01T00:00:00Z", "https://reuters.com/x"),
        sourcedAt("2026-08-01T00:00:00Z", "https://reuters.com/x"),
      ]),
      "permissive",
      { rules, now: NOW, accumulator: acc }
    );
    expect(r.warnings).toEqual([]);
  });

  test("duplicates are non-blocking under strict (warning only)", () => {
    const acc = new InMemorySourcingAccumulator(rules.dedupe!);
    validateSourcing(
      research([sourcedAt("2026-08-01T00:00:00Z", "https://reuters.com/x")]),
      "strict",
      { rules, now: NOW, accumulator: acc }
    );
    // Now the second agent emits a duplicate — must not throw.
    expect(() =>
      validateStakeholderSourcing(
        {
          stakeholders: [
            stakeholder({
              name: "A",
              position_evidence: {
                url: "https://reuters.com/x",
                title: "T",
                accessed_at: "2026-08-01T00:00:00Z",
                excerpt: "…",
              },
            }),
          ],
          key_dynamics: ["a", "b", "c"],
          blind_spots: [],
          coverage_confidence: "medium",
        },
        "strict",
        { rules, now: NOW, accumulator: acc }
      )
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// v0.5 — validateRiskSourcing (Risk agent, both evidence fields).
// ---------------------------------------------------------------------------

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    id: "RISK-001",
    category: "strategic",
    description: "A risk.",
    likelihood: "medium",
    impact: "moderate",
    likelihood_evidence: {
      url: "https://reuters.com/likelihood",
      title: "L",
      accessed_at: "2026-08-01T00:00:00Z",
      excerpt: "…",
    },
    impact_evidence: {
      url: "https://reuters.com/impact",
      title: "I",
      accessed_at: "2026-08-01T00:00:00Z",
      excerpt: "…",
    },
    affected_stakeholders: ["A"],
    timeframe: "short-term",
    mitigations: ["Do X"],
    residual_risk_after_mitigation: "low",
    ...overrides,
  };
}

function riskResult(risks: Risk[]): RiskAnalysisResult {
  return {
    risks,
    aggregated_risk_score: { overall: "medium", by_category: {} },
    top_3_priorities: risks.slice(0, 3).map((r) => r.id),
    unresolved_uncertainties: [],
  };
}

describe("validateRiskSourcing — strict", () => {
  test("passes when both evidence fields are sourced", () => {
    const report = validateRiskSourcing(
      riskResult([risk()]),
      "strict",
      { now: NOW }
    );
    expect(report.total_items).toBe(2);
    expect(report.warnings).toEqual([]);
  });

  test("throws when likelihood_evidence is missing", () => {
    let caught: unknown;
    try {
      validateRiskSourcing(
        riskResult([
          risk({
            likelihood_evidence: {
              status: "SOURCE_MISSING",
              searched_for: "q",
            },
          }),
        ]),
        "strict"
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SourcingValidationError);
    const e = caught as SourcingValidationError;
    const w = e.report.warnings[0]!;
    expect(w.kind).toBe("missing_risk_evidence");
    if (w.kind === "missing_risk_evidence") {
      expect(w.evidence_field).toBe("likelihood_evidence");
      expect(w.risk_id).toBe("RISK-001");
    }
  });

  test("throws when impact_evidence is missing", () => {
    let caught: unknown;
    try {
      validateRiskSourcing(
        riskResult([
          risk({
            impact_evidence: { status: "SOURCE_MISSING", searched_for: "q" },
          }),
        ]),
        "strict"
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SourcingValidationError);
  });
});

describe("validateRiskSourcing — permissive", () => {
  test("collects missing evidence warnings without throwing", () => {
    const report = validateRiskSourcing(
      riskResult([
        risk({
          likelihood_evidence: { status: "SOURCE_MISSING", searched_for: "l" },
          impact_evidence: { status: "SOURCE_MISSING", searched_for: "i" },
        }),
      ]),
      "permissive"
    );
    expect(report.warnings).toHaveLength(2);
    expect(report.missing_sources_count).toBe(2);
    expect(report.total_items).toBe(2);
    expect(report.counts.missing).toBe(2);
    expect(report.counts.ok).toBe(0);
  });
});


describe("validators — what mutation testing found unchecked", () => {
  const OLD = "2000-01-01T00:00:00Z";
  const THEN = new Date("2000-01-02T00:00:00Z");
  const freshness: SourcingRules = { freshness: { max_source_age_days: 365, warn_after_days: 30 } };
  const old = (url: string) => ({ url, title: "T", accessed_at: OLD, published_at: OLD, excerpt: "…" });

  test("the injected clock, not the wall clock, dates every validator's sources", () => {
    const options = { rules: freshness, now: THEN };
    expect(validateSourcing(research([sourcedAt(OLD)]), "strict", options).warnings).toEqual([]);
    const map = stakeholderMap([stakeholder({ position_evidence: old("https://a.example") })]);
    expect(validateStakeholderSourcing(map, "strict", options).warnings).toEqual([]);
    const risks = riskResult([risk({ likelihood_evidence: old("https://l.example"), impact_evidence: old("https://i.example") })]);
    expect(validateRiskSourcing(risks, "strict", options).warnings).toEqual([]);
  });

  test("risk evidence is numbered likelihood, impact, likelihood, impact", () => {
    const stale = riskResult([
      risk({ likelihood_evidence: old("https://l.example") }),
      risk({ id: "RISK-002", impact_evidence: old("https://i.example") }),
    ]);
    const report = validateRiskSourcing(stale, "permissive", { rules: freshness, now: NOW });
    expect(report.warnings).toEqual([
      expect.objectContaining({ kind: "stale_source", agent: "risk", item_index: 0 }),
      expect.objectContaining({ kind: "stale_source", agent: "risk", item_index: 3 }),
    ]);
  });

  test("a missing risk evidence names its risk and its field", () => {
    const gap = riskResult([
      risk(),
      risk({ id: "RISK-002", impact_evidence: { status: "SOURCE_MISSING", searched_for: "q" } }),
    ]);
    expect(validateRiskSourcing(gap, "permissive").warnings).toEqual([
      { kind: "missing_risk_evidence", risk_index: 1, risk_id: "RISK-002", evidence_field: "impact_evidence", searched_for: "q" },
    ]);
  });

  test("an accumulator records sources even when this format does not dedupe", () => {
    const accumulator = new InMemorySourcingAccumulator({ cross_agent: true, similarity_threshold: 0.9 });
    validateSourcing(research([sourced("https://a.example/x", "A")]), "permissive", { accumulator });
    expect(accumulator.entries()).toEqual([expect.objectContaining({ url: "https://a.example/x", agent: "research" })]);
  });

  test("without a cross-agent dedupe rule, a source seen by another agent is not a duplicate", () => {
    const accumulator = new InMemorySourcingAccumulator({ cross_agent: true, similarity_threshold: 0.9 });
    accumulator.record("https://a.example/x", "stakeholder", 0);
    const report = validateSourcing(research([sourced("https://a.example/x", "A")]), "permissive", { accumulator });
    expect(report.warnings).toEqual([]);
  });

  test("under strict, a missing source raises the base error even when other rules are set", () => {
    const rules: SourcingRules = { ...freshness, domain_trust: { mode: "reputation-only" } };
    let caught: unknown;
    try {
      validateSourcing(research([missing("q")]), "strict", { rules, now: NOW });
    } catch (err) {
      caught = err;
    }
    expect((caught as Error).constructor).toBe(SourcingValidationError);
  });
});
