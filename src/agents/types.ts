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

import type { SourceStatus } from "../sourcing/types.ts";
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
