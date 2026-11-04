/**
 * The sourcing guide the research, stakeholder, risk and options prompts
 * receive, written by code from the format's `sourcing_rules`.
 *
 * The model was told only to "prefer primary sources", so it could not know
 * which hosts the format trusts and cited pages the check then rejected. The
 * guide names them, and guides the search only: web search gets no
 * `allowed_domains`, because a relevant page outside the list is still worth
 * citing (it is reported as untrusted) and the list cannot name every
 * company's own site.
 */

import type { DomainTrustRule, SourcingPolicy, SourcingRules } from "../registry/schema.ts";

export function sourceGuidance(rules: SourcingRules | undefined, policy: SourcingPolicy): string {
  const lines = [...trustLines(rules?.domain_trust)];
  // Under strict an untrusted citation blocks the briefing as a missing one
  // does; saying only "reported" would undersell what the model risks.
  const consequence =
    policy === "strict"
      ? "under this format's strict policy it fails the sourcing check, like a missing source."
      : "it is reported as untrusted.";
  lines.push(
    "Prefer these sources when a search returns them. Cite a host marked not accepted only when no accepted host",
    `supports the item. When nothing on the list supports it, cite the best source you found rather than none;`,
    consequence,
    "Never cite a URL web_search did not return."
  );
  lines.push("");
  lines.push(
    'For each source, add "published_at": the publication date the page itself states, as',
    "YYYY-MM-DD. Leave the field out when the page states none: the source is then reported as",
    "of unknown age, never as recent. Never guess a date, and never use today's date."
  );
  const freshness = rules?.freshness;
  if (freshness !== undefined) {
    lines.push(
      `This format treats sources older than ${freshness.max_source_age_days} days as stale; prefer recent ones.`
    );
  }
  return lines.join("\n");
}

const NONE = "This format names no trusted hosts.";
// The matcher reads `*.x` as subdomains only (domain-trust.ts); a reader
// would take it to include x.
const WILDCARD = "A pattern '*.x' covers the subdomains of x, not x itself.";

function trustLines(rule: DomainTrustRule | undefined): string[] {
  const lines = listLines(rule);
  return lines.some((l) => l.includes("*.")) ? [...lines, WILDCARD] : lines;
}

function listLines(rule: DomainTrustRule | undefined): string[] {
  if (rule === undefined) return [NONE];
  if (rule.mode === "allow-list") {
    return [`Only these hosts are trusted: ${(rule.allow_list ?? []).join(", ")}.`];
  }
  if (rule.mode === "deny-list") {
    return [`These hosts are untrusted: ${(rule.deny_list ?? []).join(", ")}. Any other host is accepted.`];
  }
  const tiers = rule.reputation_tiers;
  if (tiers === undefined) return [NONE];
  const tier = (n: 1 | 2 | 3, hosts: string[]) =>
    `Tier ${n} (${n <= tiers.min_tier ? "accepted" : "not accepted"}): ${hosts.join(", ")}`;
  const listed = ([1, 2, 3] as const)
    .map((n) => ({ n, hosts: tiers[`tier_${n}`] }))
    .filter(({ hosts }) => hosts.length > 0)
    .map(({ n, hosts }) => tier(n, hosts));
  if (listed.length === 0) return [NONE];
  return ["Hosts this format trusts, by tier:", ...listed, "Any other host is untrusted."];
}
