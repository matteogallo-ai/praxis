/**
 * Shared types for Praxis agents.
 *
 * v0.2 ships only the Scoping agent. As new agents land, their input /
 * output types live in this file (or in per-agent modules that
 * re-export from here).
 */

/**
 * Inputs a Praxis agent receives at execution time.
 *
 * `input` is a free-form record whose keys must match the parameter
 * names declared in the agent's `.prompt` file. The runtime validates
 * this mapping before rendering the template.
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
