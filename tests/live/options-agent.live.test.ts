/**
 * Live integration test for the Options Generation agent end-to-end
 * against the real Anthropic API.
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set.
 */

import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { executeOptionsGeneration } from "../../src/agents/options.ts";
import { isSourceMissing } from "../../src/sourcing/types.ts";
import type {
  OptionsContext,
  RiskAnalysisResult,
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
      id: "options",
      title: "Options",
      purpose: "p",
      max_length: { words: 400 },
      required_agents: [
        "scoping",
        "research",
        "stakeholder",
        "risk",
        "options",
      ] as Format["sections"][number]["required_agents"],
      tone_directives: "n/a",
    },
  ],
  sourcing_policy: "permissive",
  style_guide: {
    voice: "neutral",
    sentence_structure: "short",
    forbidden_terms: [],
  },
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
      engagement_notes: "Track guidance publications.",
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
      engagement_notes: "Watch for joint statements.",
    },
  ],
  key_dynamics: [
    "EDPB-Commission alignment reduces enforcement uncertainty.",
    "Member-state divergence creates a compliance mosaic.",
    "Industry associations shape the pace of delegated acts.",
  ],
  blind_spots: [],
  coverage_confidence: "medium",
};

const RISKS: RiskAnalysisResult = {
  risks: [
    {
      id: "RISK-001",
      category: "regulatory",
      description: "GPAI obligations may trigger a costly compliance review cycle.",
      likelihood: "high",
      impact: "major",
      likelihood_evidence: {
        url: "https://digital-strategy.ec.europa.eu/en/policies/ai-act",
        title: "EU AI Act — Policy Overview",
        accessed_at: "2026-08-17T00:00:00Z",
        excerpt: "GPAI obligations phased in from 2026.",
      },
      impact_evidence: {
        url: "https://edpb.europa.eu/annual-report-2024",
        title: "EDPB Annual Report 2024",
        accessed_at: "2026-08-17T00:00:00Z",
        excerpt: "Enforcement costs range €0.5-3m per matter.",
      },
      affected_stakeholders: ["European Commission", "European Data Protection Board"],
      timeframe: "short-term",
      mitigations: [
        "Establish a compliance officer role and a quarterly review with the head of engineering.",
      ],
      residual_risk_after_mitigation: "medium",
    },
  ],
  aggregated_risk_score: {
    overall: "high",
    by_category: { regulatory: "high" },
  },
  top_3_priorities: ["RISK-001"],
  unresolved_uncertainties: [],
};

const CTX: OptionsContext = {
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
  risks: RISKS,
  format: FMT,
};

describe.skipIf(!hasKey)("Options Generation agent (live)", () => {
  test("returns 2-4 options with cross-artefact references honoured", async () => {
    const llm = new AnthropicLLMProvider();
    const result = await executeOptionsGeneration(CTX, llm, {
      maxToolRounds: 4,
    });
    expect(result.options.length).toBeGreaterThanOrEqual(2);
    expect(result.options.length).toBeLessThanOrEqual(4);

    const knownNames = new Set(CTX.stakeholders.stakeholders.map((s) => s.name));
    const knownRiskIds = new Set(CTX.risks.risks.map((r) => r.id));
    for (const o of result.options) {
      for (const si of o.stakeholder_impact) {
        expect(knownNames.has(si.stakeholder_name)).toBe(true);
      }
      for (const rid of o.risks_mitigated) expect(knownRiskIds.has(rid)).toBe(true);
      for (const rid of o.risks_introduced) expect(knownRiskIds.has(rid)).toBe(true);
    }

    // Exactly one recommended option, matching recommended_option_id.
    const recs = result.options.filter(
      (o) => o.recommendation_level === "recommended"
    );
    expect(recs).toHaveLength(1);
    expect(recs[0]!.id).toBe(result.recommended_option_id);

    // At least one option should carry a real source.
    const anySourced = result.options.some((o) => !isSourceMissing(o.supporting_evidence));
    expect(anySourced).toBe(true);
  }, 300_000);
});
