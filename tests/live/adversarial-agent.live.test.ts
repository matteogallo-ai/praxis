/**
 * Live integration test for the Adversarial Critique agent (v0.7).
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set. Uses a small synthetic
 * `BriefResult` as the critique input so the test does not spend
 * eight LLM round-trips to construct a fresh brief just to exercise
 * the adversarial step.
 */

import { describe, expect, test } from "bun:test";

import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { executeAdversarialCritique } from "../../src/agents/adversarial.ts";
import type {
  AdversarialContext,
  OptionsGenerationResult,
  ResearchResult,
  RiskAnalysisResult,
  StakeholderMapResult,
  SynthesisResult,
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
  id: "adversarial-live-fmt",
  name: "Adversarial live-test format",
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
      purpose: "…",
      max_length: { words: 100 },
      required_agents: ["scoping", "research"] as Format["sections"][number]["required_agents"],
      tone_directives: "n/a",
    },
    {
      id: "recommendation",
      title: "Recommendation",
      purpose: "…",
      max_length: { words: 100 },
      required_agents: ["options", "synthesis"] as Format["sections"][number]["required_agents"],
      tone_directives: "n/a",
    },
  ],
  sourcing_policy: "permissive",
  style_guide: { voice: "n", sentence_structure: "s", forbidden_terms: [] },
  output_targets: ["md"],
};

const research: ResearchResult = {
  findings: [
    { claim: "GPAI obligations took effect in 2026.", supporting_evidence: "EU Commission communication.", source: SOURCE },
  ],
  open_questions: [],
  search_queries_used: [],
};

const stakeholders: StakeholderMapResult = {
  stakeholders: [
    {
      name: "European Commission",
      category: "decision-maker",
      interest: "…",
      position: "supportive",
      position_evidence: SOURCE,
      power: "high",
      priority: "critical",
      engagement_notes: "…",
    },
  ],
  key_dynamics: ["a", "b", "c"],
  blind_spots: [],
  coverage_confidence: "medium",
};

const risks: RiskAnalysisResult = {
  risks: [
    {
      id: "RISK-001",
      category: "regulatory",
      description: "GPAI enforcement uncertainty.",
      likelihood: "medium",
      impact: "moderate",
      likelihood_evidence: SOURCE,
      impact_evidence: SOURCE,
      affected_stakeholders: ["European Commission"],
      timeframe: "short-term",
      mitigations: ["Establish a compliance officer role."],
      residual_risk_after_mitigation: "low",
    },
  ],
  aggregated_risk_score: { overall: "medium", by_category: { regulatory: "medium" } },
  top_3_priorities: ["RISK-001"],
  unresolved_uncertainties: [],
};

const options: OptionsGenerationResult = {
  options: [
    {
      id: "OPT-A",
      title: "Comply proactively",
      summary: "Establish a compliance officer role in Q1 2027.",
      tradeoffs: [
        { dimension: "cost", assessment: "0.5m/year" },
        { dimension: "time-to-market", assessment: "6 months" },
        { dimension: "regulatory-exposure", assessment: "contained" },
      ],
      stakeholder_impact: [
        { stakeholder_name: "European Commission", predicted_reaction: "supportive", impact_description: "…" },
      ],
      risks_mitigated: ["RISK-001"],
      risks_introduced: [],
      dependencies: [],
      time_horizon: "short-term",
      recommendation_level: "recommended",
      supporting_evidence: SOURCE,
    },
    {
      id: "OPT-B",
      title: "Wait for delegated acts",
      summary: "Defer compliance changes until acts publish in 2027.",
      tradeoffs: [
        { dimension: "cost", assessment: "minimal" },
        { dimension: "regulatory-exposure", assessment: "higher" },
        { dimension: "reversibility", assessment: "reversible" },
      ],
      stakeholder_impact: [
        { stakeholder_name: "European Commission", predicted_reaction: "resistant", impact_description: "…" },
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
  rationale_for_recommendation: "Get ahead of the enforcement schedule.",
  counter_arguments_considered: ["Wait-and-see is more expensive in expectation."],
  unresolved_uncertainties: [],
};

const synthesis: SynthesisResult = {
  sections: [
    { section_id: "context", title: "Context", content_markdown: "The EU AI Act's GPAI obligations took effect in 2026.", word_count: 10, sources_cited: [SOURCE], validation_issues: [], editorial_attempts: [], final_attempt_number: 1 },
    { section_id: "recommendation", title: "Recommendation", content_markdown: "Establish a compliance officer role and align with the GPAI schedule.", word_count: 10, sources_cited: [SOURCE], validation_issues: [], editorial_attempts: [], final_attempt_number: 1 },
  ],
  total_word_count: 20,
  format_conformance: {
    target_words: 200,
    actual_words: 20,
    deviation_pct: -90,
    sections_over_length: [],
    forbidden_terms_found: [],
    failed_validation_rules: [],
  },
};

const CTX: AdversarialContext = {
  brief_result: {
    scoping: {
      reformulated_question:
        "What are the top two policy trends in EU AI regulation as of 2026?",
      hidden_questions: [],
      scope_boundaries: [],
      assumptions_to_validate: [],
    },
    research,
    stakeholders,
    risks,
    options,
    synthesis,
    format_id: FMT.id,
    question: "What are the top two policy trends in EU AI regulation as of 2026?",
  },
  format: FMT,
};

describe.skipIf(!hasKey)("Adversarial Critique agent (live)", () => {
  test("returns 3-10 steelmanned critiques with valid target references", async () => {
    const llm = new AnthropicLLMProvider();
    const result = await executeAdversarialCritique(CTX, llm, {
      maxToolRounds: 4,
    });
    expect(result.critiques.length).toBeGreaterThanOrEqual(3);
    expect(result.critiques.length).toBeLessThanOrEqual(10);

    const knownSections = new Set(CTX.brief_result.synthesis.sections.map((s) => s.section_id));
    const knownOptions = new Set(CTX.brief_result.options.options.map((o) => o.id));
    const knownRisks = new Set(CTX.brief_result.risks.risks.map((r) => r.id));
    const knownStakeholders = new Set(CTX.brief_result.stakeholders.stakeholders.map((s) => s.name));
    const findingCount = CTX.brief_result.research.findings.length;

    for (const c of result.critiques) {
      if (c.target.section_id !== undefined) expect(knownSections.has(c.target.section_id)).toBe(true);
      if (c.target.option_id !== undefined) expect(knownOptions.has(c.target.option_id)).toBe(true);
      if (c.target.risk_id !== undefined) expect(knownRisks.has(c.target.risk_id)).toBe(true);
      if (c.target.stakeholder_name !== undefined) expect(knownStakeholders.has(c.target.stakeholder_name)).toBe(true);
      if (c.target.finding_index !== undefined) expect(c.target.finding_index).toBeLessThan(findingCount);
    }

    // Derived signal is coherent with severity counts.
    const derivedRevision =
      result.critical_count >= 1 || result.material_count >= 3;
    expect(result.revised_recommendation_needed).toBe(derivedRevision);
    if (derivedRevision) {
      expect(result.steelmanned_alternative).not.toBeNull();
    }
  }, 300_000);
});
