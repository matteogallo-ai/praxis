/**
 * The research, stakeholder and risk validators accept a first-party source
 * the reviewed list confirms: it is not untrusted, does not block under
 * strict, and is listed apart. A mark the list refuses changes nothing.
 */
import { describe, expect, test } from "bun:test";

import type { ResearchResult, RiskAnalysisResult, StakeholderMapResult } from "../../src/agents/types.ts";
import { mergeReports } from "../../src/sourcing/report.ts";
import type { SourcingRules } from "../../src/sourcing/types.ts";
import { UntrustedDomainError } from "../../src/sourcing/errors.ts";
import { validateRiskSourcing, validateSourcing, validateStakeholderSourcing } from "../../src/sourcing/validator.ts";

const RULES: SourcingRules = {
  domain_trust: { mode: "reputation-only", reputation_tiers: { tier_1: ["reuters.com"], tier_2: [], tier_3: [], min_tier: 2 } },
};
const NOW = new Date("2026-11-04T12:00:00Z");
const source = (url: string, mark?: string) => ({
  url,
  title: "t",
  accessed_at: "2026-11-04T00:00:00Z",
  excerpt: "e",
  ...(mark === undefined ? {} : { first_party_for: mark }),
});
const research = (claim: string, url: string, mark?: string): ResearchResult => ({
  findings: [{ claim, supporting_evidence: "x", source: source(url, mark) }],
  open_questions: [],
  search_queries_used: [],
});

describe("first-party sources in the research validators", () => {
  test("a confirmed mark is listed apart, not untrusted, and does not block under strict", () => {
    const r = validateSourcing(
      research("The FCA's listing rules allow a secondary listing.", "https://www.fca.org.uk/rules", "Financial Conduct Authority"),
      "strict",
      { rules: RULES, now: NOW }
    );
    expect(r.counts.untrusted).toBe(0);
    expect(r.counts.ok).toBe(1);
    expect(r.first_party_sources).toEqual([
      { stage: "research", item: "finding 1", organisation: "Financial Conduct Authority", url: "https://www.fca.org.uk/rules" },
    ]);
  });

  test("a mark the list refuses leaves the source untrusted and blocking", () => {
    const wrongHost = research("The FCA's listing rules allow it.", "https://fca-news.example.com/a", "Financial Conduct Authority");
    expect(() => validateSourcing(wrongHost, "strict", { rules: RULES, now: NOW })).toThrow(UntrustedDomainError);
    const notSubject = research("A rival exchange cut its fees.", "https://www.fca.org.uk/a", "Financial Conduct Authority");
    const r = validateSourcing(notSubject, "permissive", { rules: RULES, now: NOW });
    expect(r.counts.untrusted).toBe(1);
    expect(r).not.toHaveProperty("first_party_sources");
  });

  test("a trusted host needs no mark and is not listed as first-party", () => {
    const r = validateSourcing(research("FCA rules.", "https://reuters.com/a", "Financial Conduct Authority"), "strict", { rules: RULES, now: NOW });
    expect(r).not.toHaveProperty("first_party_sources");
  });

  test("stakeholders are judged on their name, risks on their description", () => {
    const stakeholders = {
      stakeholders: [{ name: "Financial Conduct Authority (FCA)", position_evidence: source("https://www.fca.org.uk/p", "Financial Conduct Authority") }],
      key_dynamics: [],
    } as unknown as StakeholderMapResult;
    const s = validateStakeholderSourcing(stakeholders, "strict", { rules: RULES, now: NOW });
    expect(s.first_party_sources?.[0]?.item).toBe("Financial Conduct Authority (FCA)");

    const risks = {
      risks: [
        {
          id: "RISK-001",
          description: "LSEG may change its listing fees.",
          likelihood_evidence: source("https://www.lseg.com/fees", "London Stock Exchange Group"),
          impact_evidence: source("https://www.lseg.com/fees", "London Stock Exchange Group"),
        },
      ],
    } as unknown as RiskAnalysisResult;
    const k = validateRiskSourcing(risks, "strict", { rules: RULES, now: NOW });
    expect(k.first_party_sources?.map((f) => f.item)).toEqual(["RISK-001 likelihood", "RISK-001 impact"]);
  });

  test("merged reports keep every first-party source", () => {
    const a = validateSourcing(research("FCA rules.", "https://www.fca.org.uk/a", "Financial Conduct Authority"), "strict", { rules: RULES, now: NOW });
    const b = validateSourcing(research("No mark.", "https://reuters.com/b"), "strict", { rules: RULES, now: NOW });
    expect(mergeReports("strict", [a, b]).first_party_sources).toHaveLength(1);
  });
});
