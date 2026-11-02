/**
 * Error hierarchy for the orchestration layer.
 */

import { PraxisError } from "../registry/errors.ts";

/** Raised when the orchestrator's inputs are inconsistent with the format. */
export class OrchestrationError extends PraxisError {
  constructor(message: string) {
    super(message);
    this.name = "OrchestrationError";
  }
}
