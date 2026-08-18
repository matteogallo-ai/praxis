import { describe, expect, test } from "bun:test";

import {
  buildReport,
  mergeReports,
  warningToCategory,
} from "../../src/sourcing/report.ts";
import type { SourcingWarning } from "../../src/sourcing/types.ts";

describe("warningToCategory", () => {
  test("missing_source → missing / research", () => {
    const w: SourcingWarning = {
      kind: "missing_source",
      finding_index: 3,
      searched_for: "q",
    };
    const r = warningToCategory(w);
    expect(r.category).toBe("missing");
    expect(r.key).toEqual({ agent: "research", item_index: 3 });
  });

  test("missing_stakeholder_evidence → missing / stakeholder", () => {
    const w: SourcingWarning = {
      kind: "missing_stakeholder_evidence",
      stakeholder_index: 1,
      stakeholder_name: "X",
      searched_for: "q",
    };
    const r = warningToCategory(w);
    expect(r.category).toBe("missing");
    expect(r.key).toEqual({ agent: "stakeholder", item_index: 1 });
  });

  test("missing_risk_evidence → missing / risk (likelihood slot at 2*i)", () => {
    const w: SourcingWarning = {
      kind: "missing_risk_evidence",
      risk_index: 3,
      risk_id: "RISK-004",
      evidence_field: "likelihood_evidence",
      searched_for: "q",
    };
    const r = warningToCategory(w);
    expect(r.category).toBe("missing");
    expect(r.key).toEqual({ agent: "risk", item_index: 6 });
  });

  test("missing_risk_evidence → missing / risk (impact slot at 2*i + 1)", () => {
    const w: SourcingWarning = {
      kind: "missing_risk_evidence",
      risk_index: 3,
      risk_id: "RISK-004",
      evidence_field: "impact_evidence",
      searched_for: "q",
    };
    const r = warningToCategory(w);
    expect(r.category).toBe("missing");
    expect(r.key).toEqual({ agent: "risk", item_index: 7 });
  });

  test("stale_source → stale", () => {
    const w: SourcingWarning = {
      kind: "stale_source",
      agent: "research",
      item_index: 2,
      url: "https://a.com",
      accessed_at: "2020-01-01T00:00:00Z",
      age_days: 900,
      exceeds_max: true,
    };
    expect(warningToCategory(w).category).toBe("stale");
  });

  test("untrusted_domain → untrusted", () => {
    const w: SourcingWarning = {
      kind: "untrusted_domain",
      agent: "research",
      item_index: 2,
      url: "https://blogspot.com",
      reason: "…",
    };
    expect(warningToCategory(w).category).toBe("untrusted");
  });

  test("duplicate_source → duplicated", () => {
    const w: SourcingWarning = {
      kind: "duplicate_source",
      agent: "stakeholder",
      item_index: 1,
      url: "https://a.com",
      previous_agent: "research",
      previous_item_index: 0,
      previous_url: "https://a.com",
    };
    expect(warningToCategory(w).category).toBe("duplicated");
  });
});

describe("buildReport — counts reconcile with total_items", () => {
  test("no warnings → everything is ok", () => {
    const r = buildReport("strict", 5, []);
    expect(r.counts).toEqual({
      ok: 5,
      stale: 0,
      untrusted: 0,
      duplicated: 0,
      missing: 0,
    });
    expect(r.total_items).toBe(5);
    expect(r.missing_sources_count).toBe(0);
  });

  test("category totals sum to total_items", () => {
    const warnings: SourcingWarning[] = [
      { kind: "missing_source", finding_index: 0, searched_for: "q" },
      {
        kind: "stale_source",
        agent: "research",
        item_index: 1,
        url: "https://a.com",
        accessed_at: "…",
        age_days: 900,
        exceeds_max: true,
      },
      {
        kind: "untrusted_domain",
        agent: "research",
        item_index: 2,
        url: "https://b.com",
        reason: "…",
      },
    ];
    const r = buildReport("permissive", 5, warnings);
    const sum =
      r.counts.ok + r.counts.stale + r.counts.untrusted + r.counts.duplicated + r.counts.missing;
    expect(sum).toBe(r.total_items);
    expect(r.counts.missing).toBe(1);
    expect(r.counts.stale).toBe(1);
    expect(r.counts.untrusted).toBe(1);
    expect(r.counts.ok).toBe(2);
    expect(r.missing_sources_count).toBe(1);
  });

  test("most severe warning wins when a single item triggers multiple", () => {
    // finding 0 is both stale AND untrusted → untrusted (more severe).
    const warnings: SourcingWarning[] = [
      {
        kind: "stale_source",
        agent: "research",
        item_index: 0,
        url: "https://a.com",
        accessed_at: "…",
        age_days: 900,
        exceeds_max: true,
      },
      {
        kind: "untrusted_domain",
        agent: "research",
        item_index: 0,
        url: "https://a.com",
        reason: "…",
      },
    ];
    const r = buildReport("permissive", 3, warnings);
    expect(r.counts.untrusted).toBe(1);
    expect(r.counts.stale).toBe(0);
    expect(r.counts.ok).toBe(2);
  });

  test("preserves the warnings array in order", () => {
    const warnings: SourcingWarning[] = [
      { kind: "missing_source", finding_index: 0, searched_for: "a" },
      { kind: "missing_source", finding_index: 1, searched_for: "b" },
    ];
    const r = buildReport("permissive", 2, warnings);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]!.kind).toBe("missing_source");
    expect(r.missing_sources_count).toBe(2);
  });
});

describe("mergeReports", () => {
  test("merges warnings and sums totals", () => {
    const a = buildReport("permissive", 3, [
      { kind: "missing_source", finding_index: 0, searched_for: "q" },
    ]);
    const b = buildReport("permissive", 4, [
      {
        kind: "missing_stakeholder_evidence",
        stakeholder_index: 1,
        stakeholder_name: "X",
        searched_for: "q",
      },
    ]);
    const merged = mergeReports("permissive", [a, b]);
    expect(merged.total_items).toBe(7);
    expect(merged.warnings).toHaveLength(2);
    expect(merged.missing_sources_count).toBe(2);
    expect(merged.counts.missing).toBe(2);
    expect(merged.counts.ok).toBe(5);
  });

  test("merges empty reports cleanly", () => {
    const merged = mergeReports("strict", []);
    expect(merged.total_items).toBe(0);
    expect(merged.warnings).toEqual([]);
  });
});
