/**
 * Error hierarchy for the orchestration layer.
 */

import { PraxisError } from "../registry/errors.ts";

/**
 * Raised by orchestration or CLI methods that exist as stubs but
 * whose behaviour is intentionally deferred to a later milestone.
 * Always fail loudly rather than returning silently.
 *
 * v0.6 removed the last internal caller (the `brief()` stub), but
 * the class remains part of the public API surface (re-exported
 * from `src/index.ts`) for downstream tooling that wants a
 * consistent "coming in vX" signal.
 */
export class NotImplementedError extends PraxisError {
  readonly feature: string;
  readonly plannedRelease: string;

  constructor(feature: string, plannedRelease: string) {
    super(
      `Not implemented: ${feature}. Planned for ${plannedRelease}. See ROADMAP.md.`
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
