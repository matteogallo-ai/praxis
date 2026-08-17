/**
 * Sourcing Layer error types.
 */

import { PraxisError } from "../registry/errors.ts";
import type { SourcingReport } from "./types.ts";

/**
 * Raised by the sourcing validators under `strict` policy when at
 * least one inspected item lacks a source. Carries the full report so
 * the caller can render an explanatory error message.
 */
export class SourcingValidationError extends PraxisError {
  readonly report: SourcingReport;

  constructor(report: SourcingReport) {
    super(
      `Sourcing validation failed under '${report.policy}' policy: ${report.missing_sources_count} of ${report.total_items} items lack a source.`
    );
    this.name = "SourcingValidationError";
    this.report = report;
  }
}
