import { describe, expect, test } from "bun:test";

import {
  evaluateDomainTrust,
  extractHost,
  matchHostPattern,
} from "../../src/sourcing/domain-trust.ts";
import type { DomainTrustRule } from "../../src/sourcing/types.ts";

describe("extractHost", () => {
  test("returns the lowercased hostname for a valid URL", () => {
    expect(extractHost("https://Reuters.COM/article/x")).toBe("reuters.com");
  });

  test("ignores path, query, fragment, and port", () => {
    expect(extractHost("https://gov.uk:8080/a/b?x=1#y")).toBe("gov.uk");
  });

  test("returns null for an unparseable URL", () => {
    expect(extractHost("not-a-url")).toBeNull();
    expect(extractHost("")).toBeNull();
  });
});

describe("matchHostPattern", () => {
  test("exact match", () => {
    expect(matchHostPattern("reuters.com", "reuters.com")).toBe(true);
    expect(matchHostPattern("bloomberg.com", "reuters.com")).toBe(false);
  });

  test("case-insensitive", () => {
    expect(matchHostPattern("REUTERS.COM", "reuters.com")).toBe(true);
    expect(matchHostPattern("reuters.com", "Reuters.Com")).toBe(true);
  });

  test("subdomain wildcard *.example.com", () => {
    expect(matchHostPattern("foo.example.com", "*.example.com")).toBe(true);
    expect(matchHostPattern("a.b.example.com", "*.example.com")).toBe(true);
    expect(matchHostPattern("example.com", "*.example.com")).toBe(false);
    expect(matchHostPattern("notexample.com", "*.example.com")).toBe(false);
  });

  test("any-TLD wildcard gov.*", () => {
    expect(matchHostPattern("gov.uk", "gov.*")).toBe(true);
    expect(matchHostPattern("gov.fr", "gov.*")).toBe(true);
    expect(matchHostPattern("gov.uk.fake", "gov.*")).toBe(false);
    expect(matchHostPattern("notgov.uk", "gov.*")).toBe(false);
  });

  test("subdomain of a multi-part TLD *.gov.uk", () => {
    expect(matchHostPattern("something.gov.uk", "*.gov.uk")).toBe(true);
    expect(matchHostPattern("x.y.gov.uk", "*.gov.uk")).toBe(true);
    expect(matchHostPattern("gov.uk", "*.gov.uk")).toBe(false);
  });

  test("rejects the empty pattern", () => {
    expect(matchHostPattern("reuters.com", "")).toBe(false);
  });

  test("*.  and .* on their own are rejected", () => {
    expect(matchHostPattern("anything.com", "*.")).toBe(false);
    expect(matchHostPattern("anything.com", ".*")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full rule evaluation
// ---------------------------------------------------------------------------

describe("evaluateDomainTrust — allow-list mode", () => {
  const rule: DomainTrustRule = {
    mode: "allow-list",
    allow_list: ["reuters.com", "*.gov"],
  };

  test("returns trusted when the host is on the list", () => {
    const r = evaluateDomainTrust("https://reuters.com/article", rule);
    expect(r.classification).toBe("trusted");
  });

  test("returns trusted for a wildcard match", () => {
    const r = evaluateDomainTrust("https://data.gov/x", rule);
    expect(r.classification).toBe("trusted");
  });

  test("returns untrusted when the host is not on the list", () => {
    const r = evaluateDomainTrust("https://medium.com/x", rule);
    expect(r.classification).toBe("untrusted");
    expect(r.reason).toContain("allow-list");
  });

  test("returns untrusted for an unparseable URL", () => {
    const r = evaluateDomainTrust("not-a-url", rule);
    expect(r.classification).toBe("untrusted");
  });
});

describe("evaluateDomainTrust — deny-list mode", () => {
  const rule: DomainTrustRule = {
    mode: "deny-list",
    deny_list: ["medium.com", "*.blogspot.com"],
  };

  test("returns untrusted when the host is on the list", () => {
    const r = evaluateDomainTrust("https://medium.com/x", rule);
    expect(r.classification).toBe("untrusted");
    expect(r.reason).toContain("deny-list");
  });

  test("returns untrusted for a wildcard match", () => {
    const r = evaluateDomainTrust("https://foo.blogspot.com/y", rule);
    expect(r.classification).toBe("untrusted");
  });

  test("returns trusted when the host is not on the list", () => {
    const r = evaluateDomainTrust("https://reuters.com/z", rule);
    expect(r.classification).toBe("trusted");
  });
});

describe("evaluateDomainTrust — reputation-only mode", () => {
  const rule: DomainTrustRule = {
    mode: "reputation-only",
    reputation_tiers: {
      tier_1: ["reuters.com", "*.gov.uk"],
      tier_2: ["hbr.org"],
      tier_3: ["wikipedia.org"],
      min_tier: 2,
    },
  };

  test("tier 1 host is trusted at min_tier 2", () => {
    expect(evaluateDomainTrust("https://reuters.com/x", rule).classification).toBe(
      "trusted"
    );
  });

  test("tier 2 host is trusted at min_tier 2", () => {
    expect(evaluateDomainTrust("https://hbr.org/y", rule).classification).toBe(
      "trusted"
    );
  });

  test("tier 3 host is untrusted at min_tier 2", () => {
    const r = evaluateDomainTrust("https://wikipedia.org/wiki/x", rule);
    expect(r.classification).toBe("untrusted");
    expect(r.reason).toContain("tier-3");
  });

  test("host outside all tiers is untrusted", () => {
    const r = evaluateDomainTrust("https://medium.com/z", rule);
    expect(r.classification).toBe("untrusted");
    expect(r.reason).toContain("no reputation tier");
  });

  test("wildcard patterns work inside tiers (*.gov.uk)", () => {
    expect(
      evaluateDomainTrust("https://ico.gov.uk/report", rule).classification
    ).toBe("trusted");
  });

  test("min_tier=1 rejects a tier-2 host", () => {
    const strict: DomainTrustRule = {
      mode: "reputation-only",
      reputation_tiers: {
        tier_1: ["reuters.com"],
        tier_2: ["hbr.org"],
        tier_3: [],
        min_tier: 1,
      },
    };
    expect(evaluateDomainTrust("https://hbr.org/x", strict).classification).toBe(
      "untrusted"
    );
  });

  test("missing reputation_tiers table returns untrusted", () => {
    const bad = { mode: "reputation-only" } as DomainTrustRule;
    expect(evaluateDomainTrust("https://x.com/y", bad).classification).toBe(
      "untrusted"
    );
  });
});
