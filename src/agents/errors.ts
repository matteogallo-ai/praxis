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
