/**
 * Cross-agent dedupe engine.
 *
 * URL normalisation:
 *   - lowercased scheme and host
 *   - trailing slash removed from the path
 *   - fragment (`#...`) removed
 *   - query parameters filtered to remove tracking noise (`utm_*`,
 *     `gclid`, `fbclid`, `mc_eid`) and re-sorted alphabetically to make
 *     `?a=1&b=2` and `?b=2&a=1` equivalent.
 *
 * Duplicate detection:
 *   - exact match after normalisation → always a duplicate.
 *   - fuzzy match: two URLs are duplicates when
 *     `Levenshtein(u1, u2) / max(len(u1), len(u2)) < 1 - similarity_threshold`.
 *     A `similarity_threshold` of 1.0 disables fuzzy matching (exact
 *     only); 0.0 collapses everything to a duplicate; the shipped
 *     formats use 0.85.
 *
 * The accumulator is scoped to a single pipeline run — the
 * Orchestrator instantiates one at the start of
 * `assessRisksAfterStakeholders` and passes it to every validator.
 *
 * A no-op accumulator (`NoopSourcingAccumulator`) is exported so
 * callers that do not run cross-agent validation can pass something of
 * the right type without special-casing `undefined`.
 */

import type {
  DedupeRule,
  SeenSource,
  SourcingAccumulator,
  SourcingAgentOrigin,
} from "./types.ts";

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "fbclid",
  "mc_eid",
  "mc_cid",
  "ref",
  "ref_src",
]);

/**
 * Normalise a URL for dedupe. Returns the lowercased URL string
 * (scheme+host+path+filtered-query) or the raw input if parsing fails
 * (in which case the accumulator falls back to exact matching).
 */
export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url.toLowerCase().trim();
  }
  parsed.hash = "";
  const preservedParams: [string, string][] = [];
  for (const [k, v] of parsed.searchParams.entries()) {
    if (!TRACKING_PARAMS.has(k.toLowerCase())) {
      preservedParams.push([k.toLowerCase(), v]);
    }
  }
  preservedParams.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  parsed.search = "";
  for (const [k, v] of preservedParams) {
    parsed.searchParams.append(k, v);
  }
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = parsed.hostname.toLowerCase();
  let pathname = parsed.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
    parsed.pathname = pathname;
  }
  return parsed.toString();
}

/**
 * Levenshtein edit distance between two strings. Two-row dynamic
 * programming so we hold `O(min(m, n))` extra memory. Runs in O(m·n)
 * time — fine at URL length.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const m = a.length;
  const n = b.length;
  let prev: number[] = new Array(n + 1);
  let curr: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const deletion = prev[j]! + 1;
      const insertion = curr[j - 1]! + 1;
      const substitution = prev[j - 1]! + cost;
      curr[j] = Math.min(deletion, insertion, substitution);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[n]!;
}

/**
 * Return `true` when `a` and `b` are considered duplicates under the
 * given similarity threshold. See module comment for the exact rule.
 */
export function isDuplicate(a: string, b: string, similarity_threshold: number): boolean {
  if (a === b) return true;
  if (similarity_threshold >= 1) return false;
  if (similarity_threshold <= 0) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  const distance = levenshtein(a, b);
  const relative = distance / maxLen;
  return relative < 1 - similarity_threshold;
}

export class InMemorySourcingAccumulator implements SourcingAccumulator {
  private readonly rule: DedupeRule;
  private readonly seen: SeenSource[] = [];

  constructor(rule: DedupeRule) {
    this.rule = rule;
  }

  record(
    url: string,
    agent: SourcingAgentOrigin,
    item_index: number
  ): SeenSource | null {
    const normalized = normalizeUrl(url);
    if (!this.rule.cross_agent) {
      this.seen.push({ url, normalized, agent, item_index });
      return null;
    }
    for (const prev of this.seen) {
      if (prev.agent === agent) continue;
      if (isDuplicate(prev.normalized, normalized, this.rule.similarity_threshold)) {
        this.seen.push({ url, normalized, agent, item_index });
        return prev;
      }
    }
    this.seen.push({ url, normalized, agent, item_index });
    return null;
  }

  size(): number {
    return this.seen.length;
  }

  entries(): readonly SeenSource[] {
    return this.seen;
  }
}

/**
 * Accumulator that never reports duplicates. Useful when the Orchestrator
 * is called without a `sourcing_rules.dedupe` block; callers can still
 * pass an accumulator of the right type without special-casing.
 */
export class NoopSourcingAccumulator implements SourcingAccumulator {
  private readonly seen: SeenSource[] = [];

  record(
    url: string,
    agent: SourcingAgentOrigin,
    item_index: number
  ): SeenSource | null {
    this.seen.push({ url, normalized: url, agent, item_index });
    return null;
  }

  size(): number {
    return this.seen.length;
  }

  entries(): readonly SeenSource[] {
    return this.seen;
  }
}
