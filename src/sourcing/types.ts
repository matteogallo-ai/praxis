/**
 * Sourcing & Verification Layer — types.
 *
 * v0.3 shipped `SourceReference | SourceMissing` and a simple
 * `strict|permissive` policy. v0.4 extended it to Stakeholder positions.
 *
 * v0.5 promotes the layer from "embryonic validator" to production-grade
 * checker. The layer now:
 *
 *   - enforces freshness (max source age),
 *   - checks the source domain against allow / deny / reputation-tier
 *     rules,
 *   - de-duplicates URLs across agents in the current pipeline run,
 *   - returns a categorised `SourcingReport` (ok / stale / untrusted /
 *     duplicated / missing) with typed warnings and errors.
 *
 * `SourcingPolicy` (`strict` | `permissive`) is retained as the failure
 * mode: `strict` throws on the first error, `permissive` collects
 * everything and returns a full report. Formats that do not declare a
 * `sourcing_rules` block get v0.4 behaviour verbatim.
 */

import type {
  DedupeRule,
  DomainTrustRule,
  FreshnessRule,
  SourcingPolicy,
  SourcingRules,
} from "../registry/schema.ts";

export type {
  DedupeRule,
  DomainTrustRule,
  FreshnessRule,
  SourcingPolicy,
  SourcingRules,
};

// ---------------------------------------------------------------------------
// SourceReference / SourceMissing / SourceStatus (unchanged from v0.4).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// v0.5 — SourcingReport (enriched) and typed warnings.
// ---------------------------------------------------------------------------

/**
 * Coarse category assigned to every inspected item.
 */
export type SourcingItemCategory =
  | "ok"
  | "stale"
  | "untrusted"
  | "duplicated"
  | "missing";

/**
 * Which agent produced the item under inspection. The report uses this
 * to attribute warnings across the cross-agent pipeline.
 */
export type SourcingAgentOrigin = "research" | "stakeholder" | "risk";

/**
 * Typed warning surfaced by the hardened sourcing validator.
 *
 * - v0.4 shipped `missing_source` / `missing_stakeholder_evidence`.
 * - v0.5 adds `missing_risk_evidence`, `stale_source`,
 *   `untrusted_domain`, `duplicate_source`.
 *
 * All variants carry enough context (index, agent origin, human-readable
 * reason) that the CLI can render them without additional lookups.
 */
export type SourcingWarning =
  | {
      kind: "missing_source";
      finding_index: number;
      searched_for: string;
    }
  | {
      kind: "missing_stakeholder_evidence";
      stakeholder_index: number;
      stakeholder_name: string;
      searched_for: string;
    }
  | {
      kind: "missing_risk_evidence";
      risk_index: number;
      risk_id: string;
      evidence_field: "likelihood_evidence" | "impact_evidence";
      searched_for: string;
    }
  | {
      kind: "stale_source";
      agent: SourcingAgentOrigin;
      item_index: number;
      url: string;
      accessed_at: string;
      age_days: number;
      /** `true` when age exceeds the hard cap (error-level under strict). */
      exceeds_max: boolean;
    }
  | {
      kind: "untrusted_domain";
      agent: SourcingAgentOrigin;
      item_index: number;
      url: string;
      reason: string;
    }
  | {
      kind: "duplicate_source";
      agent: SourcingAgentOrigin;
      item_index: number;
      url: string;
      previous_agent: SourcingAgentOrigin;
      previous_item_index: number;
      previous_url: string;
    };

/**
 * Category totals for a report. Every inspected item lands in exactly
 * one bucket, whichever is the most severe:
 *
 *   missing > untrusted > stale > duplicated > ok
 *
 * (Items with multiple problems bubble to the more severe category so
 * the totals reconcile with `total_items`.)
 */
export interface SourcingCategoryCounts {
  ok: number;
  stale: number;
  untrusted: number;
  duplicated: number;
  missing: number;
}

/**
 * Cross-agent sourcing report. Under `permissive` policy this is the
 * whole return value; under `strict`, it is attached to the error
 * thrown on the first blocking condition (see `SourcingValidationError`).
 */
export interface SourcingReport {
  policy: SourcingPolicy;
  /** Total number of items inspected across all validators. */
  total_items: number;
  /** Per-category totals (see `SourcingCategoryCounts`). */
  counts: SourcingCategoryCounts;
  /**
   * All warnings collected during validation. Under strict this list is
   * frozen at the point the first error is raised.
   */
  warnings: SourcingWarning[];

  // Convenience aliases used by v0.3/v0.4 consumers. Preserved verbatim
  // so v0.4 tests / renderers keep working during the transition.
  missing_sources_count: number;
}

// ---------------------------------------------------------------------------
// SourcingAccumulator — pipeline-scoped state for cross-agent dedupe.
// ---------------------------------------------------------------------------

/**
 * Book-keeping entry inside the accumulator. Kept internal to the
 * `dedupe` module but re-exported here so the Orchestrator can inspect
 * it in tests.
 */
export interface SeenSource {
  url: string;
  normalized: string;
  agent: SourcingAgentOrigin;
  item_index: number;
}

/**
 * Accumulator that tracks every URL seen in the current pipeline run so
 * downstream validators can flag cross-agent duplicates. Instantiated
 * once by the Orchestrator, passed to each `validate*` call.
 *
 * Implementation lives in `dedupe.ts`. The type is exposed here so
 * consumers can hold references without pulling the implementation.
 */
export interface SourcingAccumulator {
  /**
   * Register a source. Returns the previous match when the new URL is
   * a cross-agent duplicate (subject to the configured similarity
   * threshold); returns `null` when the URL is new.
   */
  record(
    url: string,
    agent: SourcingAgentOrigin,
    item_index: number
  ): SeenSource | null;
  /** Number of unique URLs recorded so far. */
  size(): number;
  /** Read-only view of every entry recorded so far (for tests). */
  entries(): readonly SeenSource[];
}
