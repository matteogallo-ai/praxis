/**
 * Freshness rule engine.
 *
 * Given a source's `accessed_at` ISO 8601 string and a `FreshnessRule`,
 * classify the source as `fresh`, `warn` (older than `warn_after_days`
 * but within `max_source_age_days`) or `stale` (older than
 * `max_source_age_days`).
 *
 * A malformed `accessed_at` string is treated as `stale` — the caller
 * cannot ship a briefing built on an unverifiable timestamp.
 */

import type { FreshnessRule } from "./types.ts";

export type FreshnessClass = "fresh" | "warn" | "stale";

export interface FreshnessResult {
  classification: FreshnessClass;
  age_days: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute age in days between `accessed_at` and `now`. Both are UTC.
 * Fractional ages are truncated with `Math.floor`.
 */
export function ageInDays(accessed_at: string, now: Date): number {
  const parsed = Date.parse(accessed_at);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  const diffMs = now.getTime() - parsed;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / MS_PER_DAY);
}

/**
 * Classify a source's freshness against a `FreshnessRule`. `now` is
 * injectable so tests can pin the clock.
 */
export function classifyFreshness(
  accessed_at: string,
  rule: FreshnessRule,
  now: Date
): FreshnessResult {
  const age = ageInDays(accessed_at, now);
  if (age > rule.max_source_age_days) {
    return { classification: "stale", age_days: age };
  }
  if (age > rule.warn_after_days) {
    return { classification: "warn", age_days: age };
  }
  return { classification: "fresh", age_days: age };
}
