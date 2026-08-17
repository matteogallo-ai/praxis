/**
 * Shared types for Praxis agents.
 *
 * v0.2 shipped the Scoping agent. v0.3 adds Research (with sourcing).
 * As new agents land their input/output types live in this file (or in
 * per-agent modules that re-export from here).
 */

import type { SourceStatus } from "../sourcing/types.ts";

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
