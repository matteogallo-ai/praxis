/**
 * Error hierarchy for the agent execution layer.
 */

import { PraxisError } from "../registry/errors.ts";

export class AgentExecutionError extends PraxisError {
  readonly agentId: string;

  constructor(agentId: string, message: string) {
    super(`Agent '${agentId}' failed: ${message}`);
    this.name = "AgentExecutionError";
    this.agentId = agentId;
  }
}

/**
 * Raised when the LLM returns text that Praxis cannot parse into the
 * agent's declared output type (invalid JSON, missing required field,
 * wrong field shape).
 */
export class InvalidAgentOutputError extends AgentExecutionError {
  readonly reason: string;
  readonly rawOutput: string;

  constructor(agentId: string, reason: string, rawOutput: string) {
    super(agentId, `invalid output — ${reason}`);
    this.name = "InvalidAgentOutputError";
    this.reason = reason;
    this.rawOutput = rawOutput;
  }
}

/**
 * Raised when a `.prompt` file cannot be loaded, parsed, or is missing
 * a required declaration.
 */
export class PromptFileError extends AgentExecutionError {
  readonly path: string;

  constructor(agentId: string, path: string, reason: string) {
    super(agentId, `prompt file '${path}' — ${reason}`);
    this.name = "PromptFileError";
    this.path = path;
  }
}

/**
 * Raised by the Research agent when a specific stage fails and cannot
 * be attributed to an LLM output problem or a prompt file problem —
 * e.g. the max tool-use round cap was hit.
 */
export class ResearchAgentError extends AgentExecutionError {
  constructor(message: string) {
    super("research", message);
    this.name = "ResearchAgentError";
  }
}

/**
 * Raised when the tool-use loop exceeds `max_tool_rounds` without the
 * model producing a final answer. Includes the cap value so the CLI
 * can suggest tuning it. Applies to any tool-using agent — the name
 * is kept from v0.3 for compatibility.
 */
export class MaxToolRoundsExceededError extends ResearchAgentError {
  readonly maxRounds: number;

  constructor(maxRounds: number) {
    super(
      `tool-use loop exceeded max_tool_rounds=${maxRounds} without a final answer`
    );
    this.name = "MaxToolRoundsExceededError";
    this.maxRounds = maxRounds;
  }
}

/**
 * Raised by the Stakeholder Mapping agent for structural failures that
 * belong neither to LLM output parsing (`InvalidAgentOutputError`) nor
 * to prompt-file loading (`PromptFileError`). Examples: fewer
 * stakeholders than the hard minimum, more than the hard maximum.
 */
export class StakeholderMappingError extends AgentExecutionError {
  constructor(message: string) {
    super("stakeholder", message);
    this.name = "StakeholderMappingError";
  }
}

/**
 * Raised by the Risk Analysis agent for structural failures that
 * belong to the domain-specific rules of the agent (invalid stakeholder
 * reference, top_3 pointing at a missing risk, aggregated_risk_score
 * inconsistency). Distinct from `RiskInflationError` (specifically:
 * more than `MAX_RISKS` were produced).
 */
export class RiskAnalysisError extends AgentExecutionError {
  constructor(message: string) {
    super("risk", message);
    this.name = "RiskAnalysisError";
  }
}

/**
 * Raised when a Risk names an `affected_stakeholders` entry that does
 * not appear in the `StakeholderMapResult` supplied to the agent.
 * Enforces the invariant "no fabricated cross-references".
 */
export class InvalidRiskStakeholderReference extends RiskAnalysisError {
  readonly riskId: string;
  readonly unknownStakeholder: string;

  constructor(riskId: string, unknownStakeholder: string, knownNames: readonly string[]) {
    super(
      `Risk '${riskId}' references unknown stakeholder '${unknownStakeholder}'. ` +
        `Known: [${knownNames.join(", ")}]`
    );
    this.name = "InvalidRiskStakeholderReference";
    this.riskId = riskId;
    this.unknownStakeholder = unknownStakeholder;
  }
}

/**
 * Raised when the Risk Analysis agent returns more than `MAX_RISKS`
 * risks. Prevents the model from padding the list to look thorough —
 * meaningful risk analysis is bounded.
 */
export class RiskInflationError extends RiskAnalysisError {
  readonly count: number;
  readonly max: number;

  constructor(count: number, max: number) {
    super(
      `Risk count ${count} exceeds the maximum of ${max}. Tighten the analysis.`
    );
    this.name = "RiskInflationError";
    this.count = count;
    this.max = max;
  }
}

// ---------------------------------------------------------------------------
// v0.6 — Options Generation agent
// ---------------------------------------------------------------------------

/**
 * Raised by the Options Generation agent for structural failures that
 * belong to the domain-specific rules of the agent (bad option count,
 * missing recommended option, non-unique tradeoff dimensions,
 * invalid recommended_option_id). Distinct from
 * `InvalidOption*Reference` (specifically: cross-artefact reference
 * failed).
 */
export class OptionsGenerationError extends AgentExecutionError {
  constructor(message: string) {
    super("options", message);
    this.name = "OptionsGenerationError";
  }
}

/**
 * Raised when an Option names a stakeholder not in the supplied
 * `StakeholderMapResult`. Same discipline as
 * `InvalidRiskStakeholderReference`.
 */
export class InvalidOptionStakeholderReference extends OptionsGenerationError {
  readonly optionId: string;
  readonly unknownStakeholder: string;

  constructor(
    optionId: string,
    unknownStakeholder: string,
    knownNames: readonly string[]
  ) {
    super(
      `Option '${optionId}' references unknown stakeholder '${unknownStakeholder}'. ` +
        `Known: [${knownNames.join(", ")}]`
    );
    this.name = "InvalidOptionStakeholderReference";
    this.optionId = optionId;
    this.unknownStakeholder = unknownStakeholder;
  }
}

/**
 * Raised when an Option's `risks_mitigated[]` or `risks_introduced[]`
 * lists a risk id absent from the supplied `RiskAnalysisResult`.
 */
export class InvalidOptionRiskReference extends OptionsGenerationError {
  readonly optionId: string;
  readonly unknownRiskId: string;
  readonly field: "risks_mitigated" | "risks_introduced";

  constructor(
    optionId: string,
    unknownRiskId: string,
    field: "risks_mitigated" | "risks_introduced",
    knownIds: readonly string[]
  ) {
    super(
      `Option '${optionId}' ${field} references unknown risk id '${unknownRiskId}'. ` +
        `Known: [${knownIds.join(", ")}]`
    );
    this.name = "InvalidOptionRiskReference";
    this.optionId = optionId;
    this.unknownRiskId = unknownRiskId;
    this.field = field;
  }
}

// ---------------------------------------------------------------------------
// v0.6 — Synthesis agent
// ---------------------------------------------------------------------------

/**
 * Raised by the Synthesis agent for structural failures — missing
 * section in output, extra section not declared in the format,
 * section_id / title mismatch, malformed JSON per section.
 *
 * `validation_issues` on `SynthesizedSection` are soft warnings and
 * do NOT raise this error. See `SynthesisValidationError` if a
 * failure classification is desired.
 */
export class SynthesisError extends AgentExecutionError {
  constructor(message: string) {
    super("synthesis", message);
    this.name = "SynthesisError";
  }
}

/**
 * Raised if a caller explicitly opts into strict format conformance —
 * i.e. wants `SynthesisResult.format_conformance` failures to be
 * throwable rather than surfaced as warnings. Not raised from the
 * agent's default execution path, but kept in the hierarchy so
 * downstream consumers (e.g. a future editorial gate) can use it.
 */
export class SynthesisValidationError extends SynthesisError {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `Synthesis format conformance failed: ${issues.length} issue(s) — ${issues[0] ?? ""}`
    );
    this.name = "SynthesisValidationError";
    this.issues = issues;
  }
}
