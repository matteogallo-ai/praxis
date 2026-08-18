import { describe, expect, test } from "bun:test";

import {
  DuplicateSourceError,
  SourcingValidationError,
  StaleSourceError,
  UntrustedDomainError,
  isBlockingUnderStrict,
} from "../../src/sourcing/errors.ts";
import { PraxisError } from "../../src/registry/errors.ts";
import type { SourcingReport, SourcingWarning } from "../../src/sourcing/types.ts";

function report(overrides: Partial<SourcingReport> = {}): SourcingReport {
  return {
    policy: "strict",
    total_items: 4,
    counts: { ok: 2, stale: 0, untrusted: 0, duplicated: 0, missing: 2 },
    missing_sources_count: 2,
    warnings: [
      { kind: "missing_source", finding_index: 1, searched_for: "X" },
      { kind: "missing_source", finding_index: 3, searched_for: "Y" },
    ],
    ...overrides,
  };
}

describe("SourcingValidationError", () => {
  test("carries the report and mentions counts and policy", () => {
    const r = report();
    const err = new SourcingValidationError(r);
    expect(err.report).toBe(r);
    expect(err.message).toContain("strict");
    expect(err.message).toContain("2");
    expect(err.message).toContain("4");
    expect(err.name).toBe("SourcingValidationError");
    expect(err).toBeInstanceOf(PraxisError);
  });

  test("works with stakeholder-evidence warnings", () => {
    const warnings: SourcingWarning[] = [
      {
        kind: "missing_stakeholder_evidence",
        stakeholder_index: 2,
        stakeholder_name: "BMDV",
        searched_for: "Berlin position statement",
      },
    ];
    const r = report({
      total_items: 5,
      missing_sources_count: 1,
      counts: { ok: 4, stale: 0, untrusted: 0, duplicated: 0, missing: 1 },
      warnings,
    });
    const err = new SourcingValidationError(r);
    expect(err.report.warnings[0]!.kind).toBe("missing_stakeholder_evidence");
    expect(err.message).toContain("strict");
    expect(err.message).toContain("1");
    expect(err.message).toContain("5");
  });
});

describe("StaleSourceError", () => {
  test("extends SourcingValidationError and carries stale-source metadata", () => {
    const r = report();
    const err = new StaleSourceError(r, "https://a.example", 900, 730);
    expect(err).toBeInstanceOf(SourcingValidationError);
    expect(err.name).toBe("StaleSourceError");
    expect(err.url).toBe("https://a.example");
    expect(err.ageDays).toBe(900);
    expect(err.maxAgeDays).toBe(730);
    expect(err.message).toContain("900");
    expect(err.message).toContain("730");
  });
});

describe("UntrustedDomainError", () => {
  test("extends SourcingValidationError and carries the reason", () => {
    const r = report();
    const err = new UntrustedDomainError(r, "https://blogspot.com/x", "matches deny-list");
    expect(err).toBeInstanceOf(SourcingValidationError);
    expect(err.name).toBe("UntrustedDomainError");
    expect(err.url).toBe("https://blogspot.com/x");
    expect(err.reason).toContain("deny-list");
    expect(err.message).toContain("deny-list");
  });
});

describe("DuplicateSourceError", () => {
  test("extends SourcingValidationError and carries the collided URLs", () => {
    const r = report();
    const err = new DuplicateSourceError(
      r,
      "https://a.example/?utm_source=x",
      "https://a.example"
    );
    expect(err).toBeInstanceOf(SourcingValidationError);
    expect(err.name).toBe("DuplicateSourceError");
    expect(err.url).toContain("utm_source");
    expect(err.previousUrl).toBe("https://a.example");
  });
});

describe("isBlockingUnderStrict", () => {
  test("missing sources are always blocking", () => {
    expect(
      isBlockingUnderStrict({
        kind: "missing_source",
        finding_index: 0,
        searched_for: "q",
      })
    ).toBe(true);
    expect(
      isBlockingUnderStrict({
        kind: "missing_stakeholder_evidence",
        stakeholder_index: 0,
        stakeholder_name: "A",
        searched_for: "q",
      })
    ).toBe(true);
    expect(
      isBlockingUnderStrict({
        kind: "missing_risk_evidence",
        risk_index: 0,
        risk_id: "RISK-001",
        evidence_field: "likelihood_evidence",
        searched_for: "q",
      })
    ).toBe(true);
  });

  test("stale sources are blocking only when they exceed the max", () => {
    expect(
      isBlockingUnderStrict({
        kind: "stale_source",
        agent: "research",
        item_index: 0,
        url: "https://a.example",
        accessed_at: "2020-01-01T00:00:00Z",
        age_days: 500,
        exceeds_max: false,
      })
    ).toBe(false);
    expect(
      isBlockingUnderStrict({
        kind: "stale_source",
        agent: "research",
        item_index: 0,
        url: "https://a.example",
        accessed_at: "2020-01-01T00:00:00Z",
        age_days: 900,
        exceeds_max: true,
      })
    ).toBe(true);
  });

  test("untrusted domains are always blocking", () => {
    expect(
      isBlockingUnderStrict({
        kind: "untrusted_domain",
        agent: "research",
        item_index: 0,
        url: "https://a.example",
        reason: "…",
      })
    ).toBe(true);
  });

  test("duplicate sources are never blocking (warning only)", () => {
    expect(
      isBlockingUnderStrict({
        kind: "duplicate_source",
        agent: "stakeholder",
        item_index: 0,
        url: "https://a.example",
        previous_agent: "research",
        previous_item_index: 0,
        previous_url: "https://a.example",
      })
    ).toBe(false);
  });
});
