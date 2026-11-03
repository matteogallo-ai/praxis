/**
 * Error hierarchy for the orchestration layer.
 */

import { PraxisError } from "../registry/errors.ts";

/**
 * @deprecated Nothing in Praxis throws this error. It stays exported only
 * because removing a named export of `src/index.ts` is a major change
 * (docs/SEMVER-CONTRACT.md); removal is scheduled for the next major
 * release. Do not throw it in new code.
 */
export class NotImplementedError extends PraxisError {
  readonly feature: string;
  readonly plannedRelease: string;

  constructor(feature: string, plannedRelease: string) {
    super(
      `Not implemented: ${feature} (target release: ${plannedRelease}; see ROADMAP.md).`
    );
    this.name = "NotImplementedError";
    this.feature = feature;
    this.plannedRelease = plannedRelease;
  }
}

/** Raised when the orchestrator's inputs are inconsistent with the format. */
export class OrchestrationError extends PraxisError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OrchestrationError";
  }
}
