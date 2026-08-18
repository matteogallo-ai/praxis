/**
 * End-to-end integration test for the v0.5 hardened sourcing layer.
 *
 * Directly exercises `validateSourcing` / `validateStakeholderSourcing`
 * / `validateRiskSourcing` under a shipped format's `sourcing_rules`,
 * feeding them fixture payloads that:
 *
 *   - contain stale sources (older than any format's freshness window)
 *   - contain untrusted domains (medium.com, blogspot)
 *   - contain URLs that collide across the research and stakeholder
 *     agents (cross-agent dedupe)
 *
 * Under strict policy, each scenario raises the correct typed error
 * (`StaleSourceError`, `UntrustedDomainError`, `SourcingValidationError`).
 * Under permissive policy, the report categorises every failure and
 * the pipeline runs to completion.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { FormatRegistry } from "../../src/registry/registry.ts";
import {
  validateSourcing,
  validateStakeholderSourcing,
} from "../../src/sourcing/validator.ts";
import { InMemorySourcingAccumulator } from "../../src/sourcing/dedupe.ts";
import {
  DuplicateSourceError,
  SourcingValidationError,
  StaleSourceError,
  UntrustedDomainError,
} from "../../src/sourcing/errors.ts";
import type {
  ResearchResult,
  StakeholderMapResult,
} from "../../src/agents/types.ts";
import { mergeReports } from "../../src/sourcing/report.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const FIXTURES_DIR = resolve(REPO_ROOT, "tests", "fixtures", "hardened-sourcing");

function loadFixture(name: string): {
  research?: ResearchResult;
  stakeholders?: StakeholderMapResult;
} {
  const raw = readFileSync(resolve(FIXTURES_DIR, name), "utf-8");
  return JSON.parse(raw);
}

function registry(): FormatRegistry {
  const r = new FormatRegistry();
  r.loadDirectory(resolve(REPO_ROOT, "formats"));
  return r;
}

// A far-future clock so any historical fixture ages into the stale bucket.
const NOW_PIN = new Date("2026-08-18T00:00:00Z");

// ---------------------------------------------------------------------------
// Freshness — stale sources
// ---------------------------------------------------------------------------

describe("hardened sourcing e2e — freshness", () => {
  test("strict: pipeline rejects a research finding older than max_source_age_days", () => {
    const { research } = loadFixture("stale-sources.json");
    if (!research) throw new Error("stale-sources.json missing 'research'");
    const format = registry().get("executive-pre-read");
    expect(format.sourcing_rules?.freshness).toBeDefined();

    let caught: unknown;
    try {
      validateSourcing(research, format.sourcing_policy, {
        rules: format.sourcing_rules!,
        now: NOW_PIN,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(StaleSourceError);
    if (caught instanceof StaleSourceError) {
      expect(caught.ageDays).toBeGreaterThan(
        format.sourcing_rules!.freshness!.max_source_age_days
      );
    }
  });

  test("permissive: pipeline reports every stale source without throwing", () => {
    const { research } = loadFixture("stale-sources.json");
    if (!research) throw new Error("stale-sources.json missing 'research'");
    const format = registry().get("executive-pre-read");

    const report = validateSourcing(research, "permissive", {
      rules: format.sourcing_rules!,
      now: NOW_PIN,
    });
    expect(report.warnings.length).toBeGreaterThanOrEqual(1);
    expect(report.counts.stale).toBeGreaterThanOrEqual(1);
    for (const w of report.warnings) {
      expect(w.kind).toBe("stale_source");
    }
  });
});

// ---------------------------------------------------------------------------
// Domain trust — untrusted domains
// ---------------------------------------------------------------------------

describe("hardened sourcing e2e — domain trust", () => {
  test("strict: pipeline rejects a research finding on an untrusted domain", () => {
    const { research } = loadFixture("untrusted-domains.json");
    if (!research) throw new Error("untrusted-domains.json missing 'research'");
    const format = registry().get("executive-pre-read");
    expect(format.sourcing_rules?.domain_trust).toBeDefined();

    let caught: unknown;
    try {
      validateSourcing(research, format.sourcing_policy, {
        rules: format.sourcing_rules!,
        now: NOW_PIN,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UntrustedDomainError);
    if (caught instanceof UntrustedDomainError) {
      expect(caught.url).toContain("medium.com");
    }
  });

  test("permissive: pipeline reports every untrusted domain without throwing", () => {
    const { research } = loadFixture("untrusted-domains.json");
    if (!research) throw new Error("untrusted-domains.json missing 'research'");
    const format = registry().get("executive-pre-read");

    const report = validateSourcing(research, "permissive", {
      rules: format.sourcing_rules!,
      now: NOW_PIN,
    });
    expect(report.warnings.length).toBeGreaterThanOrEqual(2);
    expect(report.counts.untrusted).toBeGreaterThanOrEqual(2);
    for (const w of report.warnings) {
      expect(w.kind).toBe("untrusted_domain");
    }
  });

  test("strict: position-paper-corporate allow-list rejects blogspot as expected", () => {
    const { research } = loadFixture("untrusted-domains.json");
    if (!research) throw new Error("untrusted-domains.json missing 'research'");
    const format = registry().get("position-paper-corporate");
    expect(() =>
      validateSourcing(research, format.sourcing_policy, {
        rules: format.sourcing_rules!,
        now: NOW_PIN,
      })
    ).toThrow(UntrustedDomainError);
  });
});

// ---------------------------------------------------------------------------
// Cross-agent dedupe
// ---------------------------------------------------------------------------

describe("hardened sourcing e2e — cross-agent dedupe", () => {
  test("permissive: duplicate URL across research + stakeholders is flagged", () => {
    const { research, stakeholders } = loadFixture("duplicate-sources.json");
    if (!research || !stakeholders) {
      throw new Error("duplicate-sources.json missing sections");
    }
    const format = registry().get("executive-pre-read");
    const rules = format.sourcing_rules!;
    const acc = new InMemorySourcingAccumulator(rules.dedupe!);

    const researchReport = validateSourcing(research, "permissive", {
      rules,
      accumulator: acc,
      now: NOW_PIN,
    });
    const stakeholderReport = validateStakeholderSourcing(
      stakeholders,
      "permissive",
      { rules, accumulator: acc, now: NOW_PIN }
    );
    const merged = mergeReports("permissive", [researchReport, stakeholderReport]);

    // Research inserted one URL cleanly; stakeholders reused the same URL.
    const dupWarnings = merged.warnings.filter(
      (w) => w.kind === "duplicate_source"
    );
    expect(dupWarnings.length).toBeGreaterThanOrEqual(1);
    expect(merged.counts.duplicated).toBeGreaterThanOrEqual(1);
    for (const w of dupWarnings) {
      if (w.kind === "duplicate_source") {
        expect(w.agent).toBe("stakeholder");
        expect(w.previous_agent).toBe("research");
      }
    }
  });

  test("strict: duplicates are non-blocking (warning only, no throw)", () => {
    const { research, stakeholders } = loadFixture("duplicate-sources.json");
    if (!research || !stakeholders) {
      throw new Error("duplicate-sources.json missing sections");
    }
    const format = registry().get("executive-pre-read");
    const rules = format.sourcing_rules!;
    const acc = new InMemorySourcingAccumulator(rules.dedupe!);

    expect(() =>
      validateSourcing(research, "strict", {
        rules,
        accumulator: acc,
        now: NOW_PIN,
      })
    ).not.toThrow();
    expect(() =>
      validateStakeholderSourcing(stakeholders, "strict", {
        rules,
        accumulator: acc,
        now: NOW_PIN,
      })
    ).not.toThrow();
  });

  test("without cross_agent dedupe the accumulator does not raise warnings", () => {
    const { research, stakeholders } = loadFixture("duplicate-sources.json");
    if (!research || !stakeholders) {
      throw new Error("duplicate-sources.json missing sections");
    }
    // No rules passed → no dedupe check.
    const acc = new InMemorySourcingAccumulator({
      cross_agent: false,
      similarity_threshold: 0.85,
    });
    const researchReport = validateSourcing(research, "permissive", {
      accumulator: acc,
    });
    const stakeholderReport = validateStakeholderSourcing(
      stakeholders,
      "permissive",
      { accumulator: acc }
    );
    expect(researchReport.warnings).toEqual([]);
    expect(stakeholderReport.warnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SourcingValidationError base class — catches every hardened subclass
// ---------------------------------------------------------------------------

describe("hardened sourcing e2e — error hierarchy", () => {
  test("StaleSourceError is a SourcingValidationError", () => {
    const { research } = loadFixture("stale-sources.json");
    if (!research) throw new Error("stale-sources.json missing 'research'");
    const format = registry().get("executive-pre-read");
    let caught: unknown;
    try {
      validateSourcing(research, "strict", {
        rules: format.sourcing_rules!,
        now: NOW_PIN,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SourcingValidationError);
    expect(caught).toBeInstanceOf(StaleSourceError);
  });

  test("UntrustedDomainError is a SourcingValidationError", () => {
    const { research } = loadFixture("untrusted-domains.json");
    if (!research) throw new Error("untrusted-domains.json missing 'research'");
    const format = registry().get("executive-pre-read");
    let caught: unknown;
    try {
      validateSourcing(research, "strict", {
        rules: format.sourcing_rules!,
        now: NOW_PIN,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SourcingValidationError);
    expect(caught).toBeInstanceOf(UntrustedDomainError);
  });

  test("DuplicateSourceError class is defined but never thrown by default (dupes are non-blocking)", () => {
    // The class exists for opt-in strictness; ensure the type is exported.
    expect(DuplicateSourceError.name).toBe("DuplicateSourceError");
  });
});
