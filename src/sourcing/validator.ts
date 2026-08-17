/**
 * Sourcing validator — decides whether a `ResearchResult` respects the
 * format's sourcing policy.
 *
 * - `strict`: any `SOURCE_MISSING` finding throws `SourcingValidationError`.
 * - `permissive`: missing sources are counted and returned as warnings;
 *   no exception is thrown.
 *
 * v0.3 exposes the API but only the Orchestrator wires it in for now.
 * Later releases will consume `SourcingReport` in the Editorial agent
 * to surface missing sources in the final briefing.
 */

import type {
  SourcingPolicy,
  SourcingReport,
  SourcingWarning,
} from "./types.ts";
import { isSourceMissing } from "./types.ts";
import type { ResearchResult } from "../agents/types.ts";
import { SourcingValidationError } from "./errors.ts";

export function validateSourcing(
  result: ResearchResult,
  policy: SourcingPolicy
): SourcingReport {
  const warnings: SourcingWarning[] = [];
  for (const [i, finding] of result.findings.entries()) {
    if (isSourceMissing(finding.source)) {
      warnings.push({
        kind: "missing_source",
        finding_index: i,
        searched_for: finding.source.searched_for,
      });
    }
  }
  const report: SourcingReport = {
    policy,
    total_findings: result.findings.length,
    missing_sources_count: warnings.length,
    warnings,
  };
  if (policy === "strict" && report.missing_sources_count > 0) {
    throw new SourcingValidationError(report);
  }
  return report;
}
