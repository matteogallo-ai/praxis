/**
 * Sourcing validators — decide whether an agent's output respects the
 * format's sourcing policy.
 *
 * - `strict`: any missing source throws `SourcingValidationError`.
 * - `permissive`: missing sources are counted and returned as
 *    warnings; no exception is thrown.
 *
 * v0.3 shipped `validateSourcing` for Research findings. v0.4 adds
 * `validateStakeholderSourcing` for Stakeholder positions, reusing the
 * same `SourcingReport` shape and the same policy semantics.
 * Warnings are a discriminated union so downstream consumers can
 * distinguish which agent's sourcing failed.
 */

import type {
  SourcingPolicy,
  SourcingReport,
  SourcingWarning,
} from "./types.ts";
import { isSourceMissing } from "./types.ts";
import type { ResearchResult, StakeholderMapResult } from "../agents/types.ts";
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
  return finalize(policy, result.findings.length, warnings);
}

export function validateStakeholderSourcing(
  result: StakeholderMapResult,
  policy: SourcingPolicy
): SourcingReport {
  const warnings: SourcingWarning[] = [];
  for (const [i, stakeholder] of result.stakeholders.entries()) {
    if (isSourceMissing(stakeholder.position_evidence)) {
      warnings.push({
        kind: "missing_stakeholder_evidence",
        stakeholder_index: i,
        stakeholder_name: stakeholder.name,
        searched_for: stakeholder.position_evidence.searched_for,
      });
    }
  }
  return finalize(policy, result.stakeholders.length, warnings);
}

function finalize(
  policy: SourcingPolicy,
  totalItems: number,
  warnings: SourcingWarning[]
): SourcingReport {
  const report: SourcingReport = {
    policy,
    total_items: totalItems,
    missing_sources_count: warnings.length,
    warnings,
  };
  if (policy === "strict" && report.missing_sources_count > 0) {
    throw new SourcingValidationError(report);
  }
  return report;
}
