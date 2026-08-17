/**
 * Sourcing & Verification Layer — types (v0.3 embryonic form).
 *
 * The Research agent produces findings that either carry a real
 * `SourceReference` (URL, title, excerpt) or are explicitly marked as
 * `SourceMissing`. Fabricated sources are worse than missing ones — the
 * whole point of this layer is to make the distinction structural.
 *
 * `SourcingPolicy` is re-exported from the registry schema (defined in
 * v0.1) so that formats and the sourcing layer speak the same language.
 */

import type { SourcingPolicy } from "../registry/schema.ts";

export type { SourcingPolicy };

/** A resolved, human-verifiable source. */
export interface SourceReference {
  url: string;
  title: string;
  /** ISO 8601 date (UTC), e.g. `2026-08-17T14:32:00Z`. */
  accessed_at: string;
  /** Relevant excerpt, capped at 500 characters. */
  excerpt: string;
}

/** Explicit acknowledgement that no source could be found. */
export interface SourceMissing {
  status: "SOURCE_MISSING";
  /** The query or intent the agent tried, for audit and future retry. */
  searched_for: string;
}

export type SourceStatus = SourceReference | SourceMissing;

export function isSourceMissing(s: SourceStatus): s is SourceMissing {
  return (s as SourceMissing).status === "SOURCE_MISSING";
}

/**
 * Warning surfaced by the validator when running in `permissive` mode.
 * Kept as a discriminated union so future warning kinds slot in
 * without breaking consumers.
 */
export type SourcingWarning =
  | { kind: "missing_source"; finding_index: number; searched_for: string };

/** Summary report returned by `validateSourcing` in permissive mode. */
export interface SourcingReport {
  policy: SourcingPolicy;
  total_findings: number;
  missing_sources_count: number;
  warnings: SourcingWarning[];
}
