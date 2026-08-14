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
