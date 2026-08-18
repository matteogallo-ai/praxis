/**
 * Live integration test for the Risk Analysis agent end-to-end against
 * the real Anthropic API.
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set.
 */

import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { executeRiskAnalysis } from "../../src/agents/risk.ts";
import { isSourceMissing } from "../../src/sourcing/types.ts";
import type {
  RiskContext,
  StakeholderMapResult,
} from "../../src/agents/types.ts";
import type { Format } from "../../src/registry/schema.ts";

const hasKey =
  typeof process.env["ANTHROPIC_API_KEY"] === "string" &&
  process.env["ANTHROPIC_API_KEY"]!.length > 0;

const FMT: Format = {
  id: "executive-pre-read",
  name: "Executive Pre-Read",
  version: "1.0.0",
  metadata: {
    author: "Live",
    organization_style: "generic",
    language: "en",
    last_reviewed: "2026-08-17",
  },
  target_length: { pages: 2, words: 800 },
  sections: [
    {
      id: "risks",
      title: "Risks",
      purpose: "p",
      max_length: { words: 200 },
      required_agents: [
        "scoping",
        "research",
        "stakeholder",
        "risk",
      ] as Format["sections"][number]["required_agents"],
      tone_directives: "n/a",
    },
  ],
  sourcing_policy: "permissive",
  style_guide: { voice: "neutral", sentence_structure: "short", forbidden_terms: [] },
  output_targets: ["md"],
};

const STAKEHOLDERS: StakeholderMapResult = {
  stakeholders: [
    {
      name: "European Commission",
      category: "decision-maker",
      interest: "Enforces the EU AI Act and shapes downstream guidance.",
      position: "supportive",
      position_evidence: {
        url: "https://digital-strategy.ec.europa.eu/en/policies/ai-act",
        title: "EU AI Act — Policy Overview",
        accessed_at: "2026-08-17T00:00:00Z",
        excerpt: "General Purpose AI obligations applied progressively.",
      },
      power: "high",
      priority: "critical",
      engagement_notes: "Track guidance publications; align product roadmap.",
    },
    {
      name: "European Data Protection Board",
      category: "gatekeeper",
      interest: "Consistency between the AI Act and the GDPR.",
      position: "neutral",
      position_evidence: {
        url: "https://edpb.europa.eu/annual-report-2024",
        title: "EDPB Annual Report 2024",
        accessed_at: "2026-08-17T00:00:00Z",
        excerpt: "The EDPB is coordinating with AI Act implementation.",
      },
      power: "high",
      priority: "critical",
      engagement_notes: "Watch for joint statements with the Commission.",
    },
    {
      name: "European AI industry associations",
      category: "influencer",
      interest: "Shape the implementing acts and delegate compliance costs.",
      position: "resistant",
      position_evidence: {
        url: "https://www.politico.eu/article/eu-ai-industry-position-2026",
        title: "European AI industry position on the AI Act",
        accessed_at: "2026-08-17T00:00:00Z",
        excerpt: "Industry associations argue for extended transition periods.",
      },
      power: "medium",
      priority: "important",
      engagement_notes: "Engage via association memberships early.",
    },
  ],
  key_dynamics: [
    "EDPB-Commission alignment reduces enforcement uncertainty.",
    "Industry pressure shapes the pace of delegated acts.",
    "Member-state divergence creates a compliance mosaic.",
  ],
  blind_spots: [],
  coverage_confidence: "medium",
};

const CTX: RiskContext = {
  scoping: {
    reformulated_question:
      "What are the top two policy trends in EU AI regulation as of 2026?",
    hidden_questions: ["Which regulators drive the trend?"],
    scope_boundaries: ["EU only; 2025-2026 horizon"],
    assumptions_to_validate: ["EU AI Act remains in force"],
  },
  research: {
    findings: [
      {
        claim: "The EU AI Act's General Purpose AI obligations took effect in 2026.",
        supporting_evidence: "Public EU Commission communication.",
        source: {
          url: "https://digital-strategy.ec.europa.eu/en/policies/ai-act",
          title: "EU AI Act — Policy Overview",
          accessed_at: "2026-08-17T00:00:00Z",
          excerpt: "General Purpose AI obligations applied progressively.",
        },
      },
    ],
    open_questions: [],
    search_queries_used: ["EU AI Act GPAI obligations 2026"],
  },
  stakeholders: STAKEHOLDERS,
  format: FMT,
};

describe.skipIf(!hasKey)("Risk Analysis agent (live)", () => {
  test("returns a bounded set of risks with valid cross-references", async () => {
    const llm = new AnthropicLLMProvider();
    const result = await executeRiskAnalysis(CTX, llm, {
      maxToolRounds: 4,
    });
    expect(result.risks.length).toBeGreaterThanOrEqual(3);
    expect(result.risks.length).toBeLessThanOrEqual(25);
    expect(result.top_3_priorities.length).toBe(Math.min(3, result.risks.length));

    const knownNames = new Set(CTX.stakeholders.stakeholders.map((s) => s.name));
    for (const r of result.risks) {
      expect(r.description.length).toBeGreaterThan(10);
      expect(r.mitigations.length).toBeGreaterThanOrEqual(1);
      // Every affected_stakeholders entry must match a known stakeholder name.
      for (const name of r.affected_stakeholders) {
        expect(knownNames.has(name)).toBe(true);
      }
    }

    // At least one risk should carry a real source (otherwise web_search is
    // not being exercised).
    const anySourced = result.risks.some(
      (r) => !isSourceMissing(r.likelihood_evidence) || !isSourceMissing(r.impact_evidence)
    );
    expect(anySourced).toBe(true);
  }, 300_000);
});
