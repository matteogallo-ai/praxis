/**
 * Error hierarchy for the orchestration layer.
 */

import { PraxisError } from "../registry/errors.ts";

/**
 * Raised by orchestration methods that exist as v0.2 stubs but whose
 * behaviour is intentionally deferred to a later milestone. Always
 * fail loudly rather than returning silently — the CLI depends on this
 * to render a helpful "coming in vX" message.
 */
export class NotImplementedError extends PraxisError {
  readonly feature: string;
  readonly plannedRelease: string;

  constructor(feature: string, plannedRelease: string) {
    super(
      `Not implemented in v0.2: ${feature}. Planned for ${plannedRelease}. See ROADMAP.md.`
    );
    this.name = "NotImplementedError";
    this.feature = feature;
    this.plannedRelease = plannedRelease;
  }
}

/** Raised when the orchestrator's inputs are inconsistent with the format. */
export class OrchestrationError extends PraxisError {
  constructor(message: string) {
    super(message);
    this.name = "OrchestrationError";
  }
}
