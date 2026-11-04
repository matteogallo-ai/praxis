/**
 * The sourcing guide the research, stakeholder and risk prompts receive,
 * written by code from the format's `sourcing_rules`.
 *
 * The model was told only to "prefer primary sources", so it could not know
 * which hosts the format trusts and cited pages the check then rejected. The
 * guide names them, and guides the search only: web search gets no
 * `allowed_domains`, because a relevant page outside the list is still worth
 * citing (it is reported as untrusted) and the list cannot name every
 * company's own site (ADR 0003).
 */

import type { DomainTrustRule, SourcingRules } from "../registry/schema.ts";

export function sourceGuidance(rules: SourcingRules | undefined): string {
  const lines = [...trustLines(rules?.domain_trust)];
  lines.push(
    "Prefer these sources when a search returns them. When nothing on the list supports an item,",
    "cite the best source you found rather than none; it is reported as untrusted. Never cite a",
    "URL web_search did not return."
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

function trustLines(rule: DomainTrustRule | undefined): string[] {
  if (rule === undefined) return ["This format names no trusted hosts."];
  if (rule.mode === "allow-list") {
    return [`Only these hosts are trusted: ${(rule.allow_list ?? []).join(", ")}.`];
  }
  if (rule.mode === "deny-list") {
    return [`These hosts are untrusted: ${(rule.deny_list ?? []).join(", ")}. Any other host is accepted.`];
  }
  const tiers = rule.reputation_tiers;
  if (tiers === undefined) return ["This format names no trusted hosts."];
  const tier = (n: 1 | 2 | 3, hosts: string[]) =>
    `Tier ${n} (${n <= tiers.min_tier ? "accepted" : "not accepted"}): ${hosts.join(", ")}`;
  const listed = ([1, 2, 3] as const)
    .map((n) => ({ n, hosts: tiers[`tier_${n}`] }))
    .filter(({ hosts }) => hosts.length > 0)
    .map(({ n, hosts }) => tier(n, hosts));
  return ["Hosts this format trusts, by tier:", ...listed, "Any other host is untrusted."];
}
