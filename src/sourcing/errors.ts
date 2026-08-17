/**
 * Sourcing Layer error types.
 */

import { PraxisError } from "../registry/errors.ts";
import type { SourcingReport } from "./types.ts";

/**
 * Raised by `validateSourcing` under `strict` policy when at least one
 * finding is marked `SOURCE_MISSING`. Carries the full report so the
 * caller can render an explanatory error message.
 */
export class SourcingValidationError extends PraxisError {
  readonly report: SourcingReport;

  constructor(report: SourcingReport) {
    super(
      `Sourcing validation failed under '${report.policy}' policy: ${report.missing_sources_count} of ${report.total_findings} findings lack a source URL.`
    );
    this.name = "SourcingValidationError";
    this.report = report;
  }
}
