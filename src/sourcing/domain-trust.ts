/**
 * Domain trust engine.
 *
 * Matches a URL against a `DomainTrustRule` and returns whether the URL
 * is trusted (with a human-readable reason when it is not). Supports
 * three modes:
 *
 *   - `allow-list`     the URL's host must match some pattern.
 *   - `deny-list`      the URL's host must match no pattern.
 *   - `reputation-only` the URL's host must land in a tier ≥ `min_tier`
 *                       (tier 1 highest); otherwise it is untrusted.
 *
 * Wildcard patterns supported by the matcher:
 *
 *   - `*.gov`        matches any subdomain of `gov` (e.g. `foo.gov`,
 *                    `bar.baz.gov`) — but not `gov` itself.
 *   - `gov.*`        matches `gov.uk`, `gov.fr`, but not `notgov.uk`.
 *   - `*.gov.uk`     matches `something.gov.uk`, `x.y.gov.uk`, but not
 *                    `gov.uk` itself.
 *   - `reuters.com`  exact host match.
 *
 * The matcher is host-only — path, port, query, and fragment are
 * ignored. Host comparison is case-insensitive.
 */

import type { DomainTrustRule } from "./types.ts";

export type DomainTrustClass = "trusted" | "untrusted";

export interface DomainTrustResult {
  classification: DomainTrustClass;
  /** Empty when `classification === "trusted"`. */
  reason: string;
}

/**
 * Extract the hostname from a URL. Returns `null` when the URL cannot
 * be parsed — the caller should treat that as untrusted.
 */
export function extractHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Test a host against a pattern. See the module comment for wildcard
 * semantics. Both inputs are lowercased before comparison.
 */
export function matchHostPattern(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase().trim();
  if (p.length === 0) return false;

  if (!p.includes("*")) {
    return h === p;
  }

  if (p.startsWith("*.")) {
    const suffix = p.slice(2);
    if (suffix.length === 0) return false;
    // subdomain-of match: host ends with ".suffix" but is not exactly suffix.
    return h.endsWith(`.${suffix}`);
  }

  if (p.endsWith(".*")) {
    const prefix = p.slice(0, -2);
    if (prefix.length === 0) return false;
    // any-tld match: host starts with "prefix." and the tail is non-empty.
    if (!h.startsWith(`${prefix}.`)) return false;
    const tail = h.slice(prefix.length + 1);
    return tail.length > 0 && !tail.includes(".");
  }

  // Generic wildcard fallback: translate `*` into `[^.]*` (never crosses
  // a dot) and match the full host.
  const regex = new RegExp(
    "^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^.]*") + "$"
  );
  return regex.test(h);
}

function matchAnyPattern(host: string, patterns: readonly string[]): string | null {
  for (const p of patterns) {
    if (matchHostPattern(host, p)) return p;
  }
  return null;
}

export function evaluateDomainTrust(
  url: string,
  rule: DomainTrustRule
): DomainTrustResult {
  const host = extractHost(url);
  if (host === null) {
    return { classification: "untrusted", reason: `unparseable URL '${url}'` };
  }

  if (rule.mode === "allow-list") {
    const list = rule.allow_list ?? [];
    const hit = matchAnyPattern(host, list);
    if (hit === null) {
      return {
        classification: "untrusted",
        reason: `host '${host}' matches no entry in allow-list`,
      };
    }
    return { classification: "trusted", reason: "" };
  }

  if (rule.mode === "deny-list") {
    const list = rule.deny_list ?? [];
    const hit = matchAnyPattern(host, list);
    if (hit !== null) {
      return {
        classification: "untrusted",
        reason: `host '${host}' matches deny-list entry '${hit}'`,
      };
    }
    return { classification: "trusted", reason: "" };
  }

  // reputation-only
  const tiers = rule.reputation_tiers;
  if (tiers === undefined) {
    return {
      classification: "untrusted",
      reason: "reputation-only mode without a reputation_tiers table",
    };
  }
  // A tier-N host is accepted iff `N <= min_tier`. Tier 1 is the
  // highest reputation, so a tier-1 host is always accepted regardless
  // of min_tier.
  if (matchAnyPattern(host, tiers.tier_1) !== null) {
    return { classification: "trusted", reason: "" };
  }
  if (matchAnyPattern(host, tiers.tier_2) !== null) {
    return tiers.min_tier >= 2
      ? { classification: "trusted", reason: "" }
      : {
          classification: "untrusted",
          reason: `host '${host}' is tier-2; min_tier is ${tiers.min_tier}`,
        };
  }
  if (matchAnyPattern(host, tiers.tier_3) !== null) {
    return tiers.min_tier >= 3
      ? { classification: "trusted", reason: "" }
      : {
          classification: "untrusted",
          reason: `host '${host}' is tier-3; min_tier is ${tiers.min_tier}`,
        };
  }
  return {
    classification: "untrusted",
    reason: `host '${host}' matches no reputation tier`,
  };
}
