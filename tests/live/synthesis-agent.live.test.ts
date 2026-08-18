/**
 * Live integration test for the Synthesis agent end-to-end against
 * the real Anthropic API.
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set.
 */

import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { executeSynthesis } from "../../src/agents/synthesis.ts";
import type {
  OptionsGenerationResult,
  RiskAnalysisResult,
  StakeholderMapResult,
  SynthesisContext,
} from "../../src/agents/types.ts";
import type { Format } from "../../src/registry/schema.ts";

const hasKey =
  typeof process.env["ANTHROPIC_API_KEY"] === "string" &&
  process.env["ANTHROPIC_API_KEY"]!.length > 0;

const SOURCE = {
  url: "https://digital-strategy.ec.europa.eu/en/policies/ai-act",
  title: "EU AI Act — Policy Overview",
  accessed_at: "2026-08-17T00:00:00Z",
  excerpt: "General Purpose AI obligations applied progressively.",
};

const FMT: Format = {
  id: "executive-pre-read-live",
  name: "Executive Pre-Read (live test)",
  version: "1.0.0",
  metadata: {
    author: "Live",
    organization_style: "generic",
    language: "en",
    last_reviewed: "2026-08-17",
  },
  target_length: { pages: 1, words: 200 },
  sections: [
    {
      id: "context",
      title: "Context",
      purpose: "Establish the situation in one paragraph.",
      max_length: { words: 80 },
      required_agents: [
        "scoping",
        "research",
      ] as Format["sections"][number]["required_agents"],
      tone_directives: "neutral, factual, third-person",
    },
    {
      id: "recommendation",
      title: "Recommendation",
      purpose: "State the recommended answer in the first sentence.",
      max_length: { words: 120 },
      required_agents: [
        "options",
        "synthesis",
      ] as Format["sections"][number]["required_agents"],
      tone_directives: "authoritative, imperative; lead with the verb",
    },
  ],
  sourcing_policy: "permissive",
  style_guide: {
    voice: "authoritative",
    sentence_structure: "short declarative",
    forbidden_terms: ["it seems", "perhaps"],
  },
  output_targets: ["md"],
};

const STAKEHOLDERS: StakeholderMapResult = {
  stakeholders: [
    {
      name: "European Commission",
      category: "decision-maker",
      interest: "Enforces the EU AI Act.",
      position: "supportive",
      position_evidence: SOURCE,
      power: "high",
      priority: "critical",
      engagement_notes: "Track guidance publications.",
    },
  ],
  key_dynamics: ["Commission-EDPB alignment reduces enforcement uncertainty.", "Member states diverge on speed.", "Industry associations shape delegated acts."],
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
      likelihood_evidence: SOURCE,
      impact_evidence: SOURCE,
      affected_stakeholders: ["European Commission"],
      timeframe: "short-term",
      mitigations: ["Establish a quarterly compliance review with the head of engineering."],
      residual_risk_after_mitigation: "medium",
    },
  ],
  aggregated_risk_score: { overall: "high", by_category: { regulatory: "high" } },
  top_3_priorities: ["RISK-001"],
  unresolved_uncertainties: [],
};

const OPTIONS: OptionsGenerationResult = {
  options: [
    {
      id: "OPT-A",
      title: "Comply proactively",
      summary: "Establish a compliance officer role in Q1 2027 and align internal governance to the AI Act's GPAI schedule.",
      tradeoffs: [
        { dimension: "cost", assessment: "€0.5m/year for a compliance officer plus tooling." },
        { dimension: "time-to-market", assessment: "6-month setup." },
        { dimension: "regulatory-exposure", assessment: "Contained via early alignment with Commission guidance." },
      ],
      stakeholder_impact: [
        {
          stakeholder_name: "European Commission",
          predicted_reaction: "supportive",
          impact_description: "Aligns with Commission's stated compliance schedule.",
        },
      ],
      risks_mitigated: ["RISK-001"],
      risks_introduced: [],
      dependencies: ["Board approval of the compliance officer role"],
      time_horizon: "short-term",
      recommendation_level: "recommended",
      supporting_evidence: SOURCE,
    },
    {
      id: "OPT-B",
      title: "Wait for delegated acts",
      summary: "Defer any structural compliance change until the delegated acts specifying GPAI obligations are published in 2027.",
      tradeoffs: [
        { dimension: "cost", assessment: "Minimal near-term cost." },
        { dimension: "regulatory-exposure", assessment: "Higher — Commission may enforce interim guidance strictly." },
        { dimension: "reversibility", assessment: "Reversible up to enforcement action." },
      ],
      stakeholder_impact: [
        {
          stakeholder_name: "European Commission",
          predicted_reaction: "resistant",
          impact_description: "Commission has signalled it will not tolerate wait-and-see approaches on GPAI.",
        },
      ],
      risks_mitigated: [],
      risks_introduced: ["RISK-001"],
      dependencies: [],
      time_horizon: "medium-term",
      recommendation_level: "not-recommended",
      supporting_evidence: SOURCE,
    },
  ],
  recommended_option_id: "OPT-A",
  rationale_for_recommendation:
    "OPT-A gets ahead of the Commission's stated schedule; OPT-B carries a materially higher enforcement risk without a credible mitigation.",
  counter_arguments_considered: [
    "OPT-B was considered because the delegated acts are still in draft; the Commission's public posture makes wait-and-see the more expensive option in expectation.",
  ],
  unresolved_uncertainties: [
    "The exact timeline for the delegated acts remains uncertain.",
  ],
};

const CTX: SynthesisContext = {
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
        source: SOURCE,
      },
    ],
    open_questions: [],
    search_queries_used: ["EU AI Act GPAI obligations 2026"],
  },
  stakeholders: STAKEHOLDERS,
  risks: RISKS,
  options: OPTIONS,
  format: FMT,
};

describe.skipIf(!hasKey)("Synthesis agent (live)", () => {
  test("produces one section per format.sections[] with no fabricated sources", async () => {
    const llm = new AnthropicLLMProvider();
    const result = await executeSynthesis(CTX, llm);
    expect(result.sections).toHaveLength(FMT.sections.length);
    for (const s of result.sections) {
      expect(s.content_markdown.length).toBeGreaterThan(20);
      // Every cited source must be the SOURCE we supplied.
      for (const src of s.sources_cited) {
        expect(src.url).toBe(SOURCE.url);
      }
    }
    expect(result.total_word_count).toBeGreaterThan(50);
  }, 300_000);
});
