import { describe, expect, test } from "bun:test";

import { FormatRegistry } from "../../src/registry/registry.ts";
import type { SourcingRules } from "../../src/registry/schema.ts";
import { sourceGuidance } from "../../src/sourcing/guidance.ts";

const TIERS: SourcingRules = {
  domain_trust: {
    mode: "reputation-only",
    reputation_tiers: { tier_1: ["reuters.com", "*.europa.eu"], tier_2: ["hbr.org"], tier_3: ["wikipedia.org"], min_tier: 2 },
  },
  freshness: { max_source_age_days: 730, warn_after_days: 365 },
};

describe("sourceGuidance", () => {
  test("names the accepted tiers in order, and the tiers below the format's minimum as not accepted", () => {
    const g = sourceGuidance(TIERS);
    expect(g).toContain("Tier 1 (accepted): reuters.com, *.europa.eu");
    expect(g).toContain("Tier 2 (accepted): hbr.org");
    expect(g).toContain("Tier 3 (not accepted): wikipedia.org");
    expect(g.indexOf("Tier 1")).toBeLessThan(g.indexOf("Tier 2"));
    expect(g).toContain("Any other host is untrusted.");
  });

  test("says the list guides the search and filters nothing", () => {
    // No allowed_domains: a relevant page outside the list is still cited, and reported.
    expect(sourceGuidance(TIERS)).toContain("cite the best source you found rather than none");
  });

  test("asks for the publication date the page states, never a guess", () => {
    const g = sourceGuidance(TIERS);
    expect(g).toContain("published_at");
    expect(g).toContain("older than 730 days");
    expect(g).toContain("Never guess a date");
  });

  test("an allow-list and a deny-list are named as such", () => {
    expect(sourceGuidance({ domain_trust: { mode: "allow-list", allow_list: ["*.gov", "oecd.org"] } })).toContain(
      "Only these hosts are trusted: *.gov, oecd.org"
    );
    expect(sourceGuidance({ domain_trust: { mode: "deny-list", deny_list: ["medium.com"] } })).toContain(
      "These hosts are untrusted: medium.com"
    );
  });

  test("a format without rules still asks for the publication date, and names no list", () => {
    const g = sourceGuidance(undefined);
    expect(g).toContain("published_at");
    expect(g).toContain("This format names no trusted hosts.");
    expect(g).not.toContain("Tier");
  });

  test("every shipped format renders a guide that names its own trusted hosts", () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    for (const f of registry.list()) {
      const rule = f.sourcing_rules?.domain_trust;
      const first = rule?.reputation_tiers?.tier_1[0] ?? rule?.allow_list?.[0];
      if (first !== undefined) expect(sourceGuidance(f.sourcing_rules)).toContain(first);
    }
  });
});
