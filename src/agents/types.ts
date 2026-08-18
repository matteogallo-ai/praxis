/**
 * Shared types for Praxis agents.
 *
 * v0.2 shipped Scoping. v0.3 added Research (with sourcing). v0.4
 * adds Stakeholder Mapping — the first agent whose input includes
 * both prior outputs.
 *
 * As new agents land their input/output types live in this file (or
 * in per-agent modules that re-export from here).
 */

import type { SourceReference, SourceStatus } from "../sourcing/types.ts";
import type { Format } from "../registry/schema.ts";

/**
 * Inputs the Scoping agent receives at execution time.
 *
 * The runtime validates this against the parameters declared in the
 * agent's `.prompt` file before rendering the template.
 */
export interface AgentContext {
  question: string;
  formatId: string;
  targetWords: number;
}

/**
 * The structured output of the Scoping agent. Enforced on the Praxis
 * side by `parseScopingResult` in `src/agents/scoping.ts`.
 */
export interface ScopingResult {
  reformulated_question: string;
  hidden_questions: string[];
  scope_boundaries: string[];
  assumptions_to_validate: string[];
}

/**
 * Inputs the Research agent receives at execution time. Built by the
 * Orchestrator from the format and the Scoping agent's output.
 */
export interface ResearchContext {
  scoping: ScopingResult;
  formatId: string;
  sourcingPolicy: "strict" | "permissive";
  targetWords: number;
}

/**
 * A single evidence-backed claim produced by the Research agent. Each
 * finding is either sourced (`SourceReference`) or explicitly marked
 * missing (`SourceMissing`). The sourcing layer validates this.
 */
export interface Finding {
  claim: string;
  supporting_evidence: string;
  source: SourceStatus;
}

/**
 * The structured output of the Research agent.
 */
export interface ResearchResult {
  findings: Finding[];
  /** Scoping questions still unanswered after research. */
  open_questions: string[];
  /** Every search query the agent issued, in order. Audit trail. */
  search_queries_used: string[];
}

// ---------------------------------------------------------------------------
// v0.4 — Stakeholder Mapping agent
// ---------------------------------------------------------------------------

/**
 * Coarse role a stakeholder plays with respect to the briefing question.
 *
 *   - `decision-maker`     the actor(s) who formally decide.
 *   - `influencer`         shapes the decision without owning it.
 *   - `gatekeeper`         controls a resource, approval, or channel
 *                          the decision must pass through.
 *   - `affected-party`     bears consequences without shaping the call.
 *   - `external-observer`  regulators, media, watchdogs — outside the
 *                          decision but able to escalate cost.
 */
export type StakeholderCategory =
  | "decision-maker"
  | "influencer"
  | "gatekeeper"
  | "affected-party"
  | "external-observer";

/** Capacity to act on the question. Not the same as position. */
export type StakeholderPower = "high" | "medium" | "low";

/**
 * Where a stakeholder stands relative to the direction the briefing is
 * leaning. `unknown` is a legitimate answer — pretending otherwise is
 * how a mapping starts lying.
 */
export type StakeholderPosition =
  | "supportive"
  | "neutral"
  | "resistant"
  | "unknown";

/**
 * How much attention the engagement plan should give this stakeholder.
 * `critical` = deal-maker/breaker; `important` = must be handled;
 * `monitor` = watch for change, no active engagement needed.
 */
export type StakeholderPriority = "critical" | "important" | "monitor";

/**
 * A single stakeholder. `position_evidence` obeys the same sourcing
 * discipline as Research findings: either a real `SourceReference` or
 * an explicit `SOURCE_MISSING` marker. Fabricated evidence is
 * structurally forbidden.
 */
export interface Stakeholder {
  name: string;
  category: StakeholderCategory;
  /** One or two sentences: what they care about in this question. */
  interest: string;
  position: StakeholderPosition;
  position_evidence: SourceStatus;
  power: StakeholderPower;
  priority: StakeholderPriority;
  /** One or two sentences: how the reader should engage them. */
  engagement_notes: string;
}

/** Self-assessed completeness of the mapping. */
export type CoverageConfidence = "high" | "medium" | "low";

/**
 * The structured output of the Stakeholder Mapping agent.
 *
 * Hard caps enforced by `parseStakeholderMapResult`:
 *   - `stakeholders.length` must satisfy `MIN_STAKEHOLDERS <= n <= MAX_STAKEHOLDERS`.
 *     A run producing fewer than 3 is treated as failure; between 3
 *     and 4 is a warning (the parser accepts it, the CLI surfaces the
 *     thinness); above 20 is a hard failure.
 */
export interface StakeholderMapResult {
  stakeholders: Stakeholder[];
  /** 3-5 alliance / tension / dependency dynamics binding the actors. */
  key_dynamics: string[];
  /** Actors suspected but under-documented. Honest gaps only. */
  blind_spots: string[];
  coverage_confidence: CoverageConfidence;
}

/**
 * Inputs the Stakeholder Mapping agent receives at execution time.
 * Built by the Orchestrator from the format and the two prior agent
 * outputs.
 */
export interface StakeholderContext {
  scoping: ScopingResult;
  research: ResearchResult;
  format: Format;
}

// ---------------------------------------------------------------------------
// v0.5 — Risk Analysis agent
// ---------------------------------------------------------------------------

/**
 * Canonical taxonomy for risk categories. Deliberately eight buckets:
 * five classical business categories plus reputational, geopolitical,
 * and human-capital — the three the shipped formats care about most.
 */
export type RiskCategory =
  | "strategic"
  | "operational"
  | "financial"
  | "regulatory"
  | "reputational"
  | "geopolitical"
  | "technological"
  | "human-capital";

export const RISK_CATEGORIES: readonly RiskCategory[] = [
  "strategic",
  "operational",
  "financial",
  "regulatory",
  "reputational",
  "geopolitical",
  "technological",
  "human-capital",
] as const;

export type RiskLikelihood =
  | "very-low"
  | "low"
  | "medium"
  | "high"
  | "very-high";

export const RISK_LIKELIHOODS: readonly RiskLikelihood[] = [
  "very-low",
  "low",
  "medium",
  "high",
  "very-high",
] as const;

export type RiskImpact =
  | "negligible"
  | "minor"
  | "moderate"
  | "major"
  | "severe";

export const RISK_IMPACTS: readonly RiskImpact[] = [
  "negligible",
  "minor",
  "moderate",
  "major",
  "severe",
] as const;

/**
 * `< 3mo` / `3-12mo` / `1-3y` / `> 3y`.
 */
export type RiskTimeframe =
  | "immediate"
  | "short-term"
  | "medium-term"
  | "long-term";

export const RISK_TIMEFRAMES: readonly RiskTimeframe[] = [
  "immediate",
  "short-term",
  "medium-term",
  "long-term",
] as const;

/** Aggregated overall / by-category risk score. */
export type AggregatedRiskLevel = "low" | "medium" | "high" | "critical";

export const AGGREGATED_RISK_LEVELS: readonly AggregatedRiskLevel[] = [
  "low",
  "medium",
  "high",
  "critical",
] as const;

/**
 * A single risk. Every `Risk` carries sourced evidence for BOTH its
 * likelihood assessment AND its impact assessment — same discipline as
 * Research findings and Stakeholder positions.
 *
 * `affected_stakeholders` must reference names present in the
 * `StakeholderMapResult` supplied to the agent. The parser rejects any
 * risk that names an unknown stakeholder — fabricated links are
 * structurally forbidden.
 */
export interface Risk {
  /** `RISK-001`, `RISK-002`, … — assigned sequentially by the parser. */
  id: string;
  category: RiskCategory;
  /** One or two sentences describing the risk. */
  description: string;
  likelihood: RiskLikelihood;
  impact: RiskImpact;
  likelihood_evidence: SourceStatus;
  impact_evidence: SourceStatus;
  /**
   * Stakeholder names lifted verbatim from the mapping. The parser
   * validates every entry against the supplied `StakeholderMapResult`.
   */
  affected_stakeholders: string[];
  timeframe: RiskTimeframe;
  /** 1-3 concrete mitigations. Vague statements ("monitor closely") are rejected. */
  mitigations: string[];
  residual_risk_after_mitigation: RiskLikelihood;
}

/**
 * The structured output of the Risk Analysis agent.
 */
export interface RiskAnalysisResult {
  risks: Risk[];
  aggregated_risk_score: {
    overall: AggregatedRiskLevel;
    /** Only categories with at least one Risk need to appear. */
    by_category: Partial<Record<RiskCategory, AggregatedRiskLevel>>;
  };
  /** IDs of the 3 most critical risks (must reference `risks[].id`). */
  top_3_priorities: string[];
  /** Analytical gaps the agent could not close. */
  unresolved_uncertainties: string[];
}

/**
 * Inputs the Risk Analysis agent receives at execution time. First
 * Praxis agent to consume THREE prior outputs.
 */
export interface RiskContext {
  scoping: ScopingResult;
  research: ResearchResult;
  stakeholders: StakeholderMapResult;
  format: Format;
}

// ---------------------------------------------------------------------------
// v0.6 — Options Generation agent
// ---------------------------------------------------------------------------

/**
 * How the agent frames each option to the reader. Only one option in a
 * `OptionsGenerationResult` may be `recommended` — the parser enforces
 * this. `not-recommended` is a valid downgrade for options that were
 * considered and dismissed on their merits (the reader wants to know
 * they were considered).
 */
export type OptionRecommendationLevel =
  | "recommended"
  | "acceptable"
  | "not-recommended";

export const OPTION_RECOMMENDATION_LEVELS: readonly OptionRecommendationLevel[] = [
  "recommended",
  "acceptable",
  "not-recommended",
] as const;

/**
 * One tradeoff dimension along which an option is assessed. `dimension`
 * must be a concrete word (e.g. `cost`, `time-to-market`,
 * `regulatory-exposure`) — vague labels like `pros` / `cons` are
 * rejected by the parser as a quality safeguard.
 */
export interface OptionTradeoff {
  dimension: string;
  assessment: string;
}

/** Stakeholder-specific prediction attached to an option. */
export interface OptionStakeholderImpact {
  /** Must reference a name in `StakeholderMapResult.stakeholders[].name`. */
  stakeholder_name: string;
  predicted_reaction: StakeholderPosition;
  impact_description: string;
}

/**
 * A single course of action. Every `Option` must:
 *   - carry a distinct `id` (`OPT-A`, `OPT-B`, `OPT-C`, `OPT-D`);
 *   - reference existing stakeholder names in `stakeholder_impact[]`
 *     (parser rejects fabricated names);
 *   - reference existing risk IDs in `risks_mitigated[]` and
 *     `risks_introduced[]` (parser rejects fabricated IDs);
 *   - carry a `supporting_evidence` that is either a real
 *     `SourceReference` or an explicit `SOURCE_MISSING` marker.
 */
export interface Option {
  /** `OPT-A`, `OPT-B`, `OPT-C`, `OPT-D` — assigned sequentially by the parser. */
  id: string;
  /** Short, descriptive title (used as a headline in the briefing). */
  title: string;
  /** Two or three sentences describing the option. */
  summary: string;
  /** 3-6 dimensions. Vague labels (`pros`, `cons`) are rejected. */
  tradeoffs: OptionTradeoff[];
  /** Cross-referenced stakeholder predictions. */
  stakeholder_impact: OptionStakeholderImpact[];
  /** IDs of risks this option would mitigate. Cross-checked. */
  risks_mitigated: string[];
  /** IDs of risks this option would introduce. Cross-checked. */
  risks_introduced: string[];
  /** Prerequisites needed to execute this option. */
  dependencies: string[];
  time_horizon: RiskTimeframe;
  recommendation_level: OptionRecommendationLevel;
  supporting_evidence: SourceStatus;
}

/**
 * The structured output of the Options Generation agent.
 *
 * Hard caps enforced by `parseOptionsGenerationResult`:
 *   - `options.length` must satisfy `MIN_OPTIONS <= n <= MAX_OPTIONS`
 *     (2-4). Fewer than 2 undermines the "genuine choice" discipline;
 *     more than 4 is padding.
 *   - `recommended_option_id` must reference an existing `Option.id`.
 *   - Exactly one option must carry `recommendation_level === "recommended"`.
 */
export interface OptionsGenerationResult {
  options: Option[];
  recommended_option_id: string;
  /** 3-5 sentences explaining why the recommended option won. */
  rationale_for_recommendation: string;
  /** Why the other options were considered and set aside. */
  counter_arguments_considered: string[];
  unresolved_uncertainties: string[];
}

/**
 * Inputs the Options Generation agent receives at execution time.
 * Consumes ALL four prior outputs — the first agent whose context is
 * the full upstream stack.
 */
export interface OptionsContext {
  scoping: ScopingResult;
  research: ResearchResult;
  stakeholders: StakeholderMapResult;
  risks: RiskAnalysisResult;
  format: Format;
}

// ---------------------------------------------------------------------------
// v0.6 — Synthesis agent
// ---------------------------------------------------------------------------

/**
 * One section of the final briefing, produced by the Synthesis agent.
 * `section_id` and `title` mirror the `Format.sections[]` entry the
 * synthesis is targeting; the synthesis loop drives one call per
 * section.
 *
 * `validation_issues` is a list of soft warnings (max_length exceeded,
 * forbidden_terms detected, unmet validation_rule). They are surfaced
 * to the reader but do not fail the pipeline — the point is
 * transparency, not censorship.
 */
export interface SynthesizedSection {
  section_id: string;
  title: string;
  /** The section text, in Markdown. Trailing newline optional. */
  content_markdown: string;
  word_count: number;
  /** Sources cited in this section, lifted from upstream artefacts. */
  sources_cited: SourceReference[];
  validation_issues: string[];
  /**
   * v0.8: history of every LLM attempt made for this section under
   * `strict_editorial` mode. Empty array when strict_editorial is
   * off or the first attempt was accepted. Populated with
   * per-attempt `EditorialAttempt` entries when a retry was
   * triggered (each entry records the reason and whether the
   * attempt was accepted).
   */
  editorial_attempts: EditorialAttempt[];
  /**
   * v0.8: 1-based index of the attempt whose output is stored in
   * `content_markdown`. Defaults to 1 (first attempt accepted).
   */
  final_attempt_number: number;
}

/**
 * v0.8: one entry per LLM attempt made for a section under
 * `strict_editorial` mode. `reason` names the rule that triggered
 * the retry when `accepted === false`; `details` is a
 * human-readable explanation (e.g. `"terms found: 'obviously', 'clearly'"`).
 */
export interface EditorialAttempt {
  attempt_number: number;
  reason: "forbidden_terms" | "over_length" | "validation_rule" | "accepted";
  details: string;
  accepted: boolean;
}

/**
 * Per-section forbidden-term hit. `count` is how many times the term
 * appeared in the section, case-insensitive.
 */
export interface ForbiddenTermHit {
  term: string;
  section_id: string;
  count: number;
}

/** Per-section validation_rules string that the synthesis failed. */
export interface FailedValidationRule {
  section_id: string;
  rule: string;
}

/**
 * Aggregated format-conformance report attached to a synthesis run.
 * `deviation_pct` is the signed relative deviation from
 * `target_words` (positive = over, negative = under).
 */
export interface FormatConformance {
  target_words: number;
  actual_words: number;
  deviation_pct: number;
  sections_over_length: string[];
  forbidden_terms_found: ForbiddenTermHit[];
  failed_validation_rules: FailedValidationRule[];
}

/**
 * The structured output of the Synthesis agent.
 *
 * `sections` are in the SAME ORDER as `format.sections[]` — the
 * synthesis loop drives that ordering deterministically. Every
 * section id in the format must appear exactly once; the parser
 * rejects missing or extra sections.
 */
export interface SynthesisResult {
  sections: SynthesizedSection[];
  total_word_count: number;
  format_conformance: FormatConformance;
}

/**
 * Inputs the Synthesis agent receives at execution time. Consumes ALL
 * five prior artefacts — synthesis has no analytical latitude of its
 * own, it only assembles.
 */
export interface SynthesisContext {
  scoping: ScopingResult;
  research: ResearchResult;
  stakeholders: StakeholderMapResult;
  risks: RiskAnalysisResult;
  options: OptionsGenerationResult;
  format: Format;
  /**
   * v0.8: when present, tells the Synthesis agent to run in
   * REVISION MODE — re-writing sections to address the supplied
   * critical/material critiques and align the recommendation with
   * the steelmanned alternative. Set by
   * `Orchestrator.briefWithCritiqueAndRerun()` and NEVER by
   * end-user code.
   */
  revision_context?: RevisionContext;
}

/**
 * v0.8: parameters that flip the Synthesis agent into revision
 * mode. The prompt exposes an additional REVISION section when
 * `revision_context` is supplied; the model MUST preserve the
 * existing section IDs / titles / structure and MUST address the
 * listed critiques.
 */
export interface RevisionContext {
  original_synthesis: SynthesisResult;
  adversarial: AdversarialCritiqueResult;
  /** Critical + material critiques the model must address. */
  critiques_to_address: Critique[];
  steelmanned_alternative: string | null;
  /** Free-form instruction — currently "revise sections and align recommendation". */
  instruction: string;
}

// ---------------------------------------------------------------------------
// v0.7 — Adversarial Critique agent
// ---------------------------------------------------------------------------

/**
 * Fixed taxonomy of critique categories. Chosen to cover the ways a
 * hostile-but-fair reviewer typically breaks a briefing: unstated
 * assumptions, weak sourcing, dismissed options, over-confidence,
 * missing perspectives, internal contradictions, under-estimated
 * risks, and temporal blind spots (assumptions about stability that
 * may not hold).
 */
export type CritiqueCategory =
  | "hidden-assumption"
  | "weak-source"
  | "dismissed-option"
  | "overconfidence"
  | "missing-perspective"
  | "internal-contradiction"
  | "risk-underestimated"
  | "temporal-blind-spot";

export const CRITIQUE_CATEGORIES: readonly CritiqueCategory[] = [
  "hidden-assumption",
  "weak-source",
  "dismissed-option",
  "overconfidence",
  "missing-perspective",
  "internal-contradiction",
  "risk-underestimated",
  "temporal-blind-spot",
] as const;

/**
 * How much the critique should shift the reader's confidence in the
 * recommendation.
 *
 *   minor    — legitimate but does not change the recommendation.
 *   material — the recommendation stands but needs an explicit hedge.
 *   critical — the recommendation should be revisited.
 */
export type CritiqueSeverity = "minor" | "material" | "critical";

export const CRITIQUE_SEVERITIES: readonly CritiqueSeverity[] = [
  "minor",
  "material",
  "critical",
] as const;

/**
 * Precise reference to WHAT the critique is aimed at inside the
 * `BriefResult`. At least one field is required — the parser rejects
 * an empty target as `InvalidCritiqueTargetError`. Multiple fields
 * are legitimate when a critique straddles (e.g. a risk that maps to
 * a stakeholder).
 */
export interface CritiqueTarget {
  section_id?: string;
  option_id?: string;
  risk_id?: string;
  stakeholder_name?: string;
  finding_index?: number;
}

/**
 * A single critique. Every field is deliberately load-bearing:
 *
 *   - `steelmanned_position` MUST be ≥ 20 words. The parser rejects
 *     bâclé critiques so an under-thought critique does not get
 *     shipped as if it were considered.
 *   - `counter_evidence` follows the same SourceReference /
 *     SOURCE_MISSING discipline as Research findings — fabricated
 *     counter-evidence is worse than acknowledged absence.
 *   - `target` fields must reference existing artefacts in the
 *     `BriefResult`; unknown references raise
 *     `InvalidCritiqueTargetError`.
 */
export interface Critique {
  /** `CRIT-001`, `CRIT-002`, … — assigned sequentially by the parser. */
  id: string;
  category: CritiqueCategory;
  severity: CritiqueSeverity;
  target: CritiqueTarget;
  /** The counter-argument stated at its strongest. ≥ 20 words. */
  steelmanned_position: string;
  counter_evidence: SourceStatus;
  /** 1-2 sentences: what changes in the recommendation if this holds. */
  implication_if_true: string;
  /** 1 sentence: how the brief should be adjusted. */
  suggested_revision: string;
}

/**
 * The structured output of the Adversarial Critique agent.
 *
 * `revised_recommendation_needed` is a DERIVED signal enforced by the
 * parser: `true` iff at least one `critical` critique OR at least
 * three `material` critiques exist. If the signal is true,
 * `steelmanned_alternative` MUST be a non-empty string — the reader
 * needs somewhere to land if the current recommendation is challenged.
 *
 * `critical_count` / `material_count` / `minor_count` are populated
 * from `critiques[]` by the parser (redundant caches for downstream
 * consumers).
 */
export interface AdversarialCritiqueResult {
  critiques: Critique[];
  critical_count: number;
  material_count: number;
  minor_count: number;
  recommendation_robustness: "high" | "medium" | "low";
  revised_recommendation_needed: boolean;
  steelmanned_alternative: string | null;
}

/**
 * Inputs the Adversarial Critique agent receives at execution time.
 * The seventh Praxis agent — consumes the ENTIRE `BriefResult`
 * produced by the six prior agents (Scoping → Research → Stakeholders
 * → Risks → Options → Synthesis).
 *
 * Note: this file cannot import `BriefResult` directly (the
 * orchestrator depends on `types.ts`, not the other way around).
 * The agent takes a structural equivalent, defined here to break the
 * cycle.
 */
export interface AdversarialContext {
  brief_result: {
    scoping: ScopingResult;
    research: ResearchResult;
    stakeholders: StakeholderMapResult;
    risks: RiskAnalysisResult;
    options: OptionsGenerationResult;
    synthesis: SynthesisResult;
    format_id: string;
    question: string;
  };
  format: Format;
}
