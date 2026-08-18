/**
 * Sourcing Layer error types.
 *
 * v0.3–v0.4 shipped `SourcingValidationError` — raised under `strict`
 * policy whenever an inspected item lacked a source.
 *
 * v0.5 keeps that top-level error and adds three domain-specific
 * subclasses for the hardened rules (freshness, domain trust, dedupe).
 * All new subclasses inherit from `SourcingValidationError` so callers
 * that catch the parent type keep working; typed handlers can narrow.
 */

import { PraxisError } from "../registry/errors.ts";
import type { SourcingReport, SourcingWarning } from "./types.ts";

/**
 * Raised by the sourcing validators under `strict` policy when at
 * least one inspected item fails a rule. Carries the (frozen) report
 * so the caller can render an explanatory error message and inspect
 * which items failed and why.
 */
export class SourcingValidationError extends PraxisError {
  readonly report: SourcingReport;

  constructor(report: SourcingReport, message?: string) {
    super(
      message ??
        `Sourcing validation failed under '${report.policy}' policy: ${report.missing_sources_count} of ${report.total_items} items lack a source.`
    );
    this.name = "SourcingValidationError";
    this.report = report;
  }
}

/**
 * Raised when a source's `accessed_at` timestamp exceeds the format's
 * `sourcing_rules.freshness.max_source_age_days` under `strict` policy.
 */
export class StaleSourceError extends SourcingValidationError {
  readonly url: string;
  readonly ageDays: number;
  readonly maxAgeDays: number;

  constructor(
    report: SourcingReport,
    url: string,
    ageDays: number,
    maxAgeDays: number
  ) {
    super(
      report,
      `Stale source under '${report.policy}' policy: '${url}' is ${ageDays} days old (max: ${maxAgeDays}).`
    );
    this.name = "StaleSourceError";
    this.url = url;
    this.ageDays = ageDays;
    this.maxAgeDays = maxAgeDays;
  }
}

/**
 * Raised when a source's domain fails the format's `domain_trust`
 * rule (allow-list miss, deny-list hit, or reputation tier below
 * `min_tier`) under `strict` policy.
 */
export class UntrustedDomainError extends SourcingValidationError {
  readonly url: string;
  readonly reason: string;

  constructor(report: SourcingReport, url: string, reason: string) {
    super(
      report,
      `Untrusted domain under '${report.policy}' policy: '${url}' — ${reason}`
    );
    this.name = "UntrustedDomainError";
    this.url = url;
    this.reason = reason;
  }
}

/**
 * Raised when a source URL duplicates another URL already recorded by
 * the cross-agent accumulator, and the format's dedupe rule treats
 * duplicates as errors (opt-in — the default treats them as warnings).
 */
export class DuplicateSourceError extends SourcingValidationError {
  readonly url: string;
  readonly previousUrl: string;

  constructor(report: SourcingReport, url: string, previousUrl: string) {
    super(
      report,
      `Duplicate source under '${report.policy}' policy: '${url}' collides with '${previousUrl}' from an earlier agent.`
    );
    this.name = "DuplicateSourceError";
    this.url = url;
    this.previousUrl = previousUrl;
  }
}

/**
 * Discriminant helper: does this warning represent a blocking condition
 * under strict policy? Missing sources and stale-past-max are blocking;
 * duplicates default to non-blocking (warning only).
 *
 * Kept separate from the class hierarchy so the validators can decide
 * whether to throw before allocating an error instance.
 */
export function isBlockingUnderStrict(w: SourcingWarning): boolean {
  if (w.kind === "missing_source") return true;
  if (w.kind === "missing_stakeholder_evidence") return true;
  if (w.kind === "missing_risk_evidence") return true;
  if (w.kind === "stale_source") return w.exceeds_max;
  if (w.kind === "untrusted_domain") return true;
  if (w.kind === "duplicate_source") return false;
  return false;
}
