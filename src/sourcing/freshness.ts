/**
 * Freshness rule engine.
 *
 * Given a source's publication date and a `FreshnessRule`, classify the
 * source as `fresh`, `warn` (older than `warn_after_days` but within
 * `max_source_age_days`), `stale` (older than `max_source_age_days`) or
 * `unknown` (no readable publication date). The retrieval time is not used:
 * every source is retrieved during the run, so it would make all of them
 * fresh.
 */

import type { FreshnessRule } from "./types.ts";

type FreshnessClass = "fresh" | "warn" | "stale" | "unknown";

export interface FreshnessResult {
  classification: FreshnessClass;
  /** `null` when the publication date is unknown. */
  age_days: number | null;
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
  published_at: string | undefined,
  rule: FreshnessRule,
  now: Date
): FreshnessResult {
  if (published_at === undefined || Number.isNaN(Date.parse(published_at))) {
    return { classification: "unknown", age_days: null };
  }
  const age = ageInDays(published_at, now);
  if (age > rule.max_source_age_days) {
    return { classification: "stale", age_days: age };
  }
  if (age > rule.warn_after_days) {
    return { classification: "warn", age_days: age };
  }
  return { classification: "fresh", age_days: age };
}
