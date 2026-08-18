import { describe, expect, test } from "bun:test";

import {
  InMemorySourcingAccumulator,
  NoopSourcingAccumulator,
  isDuplicate,
  levenshtein,
  normalizeUrl,
} from "../../src/sourcing/dedupe.ts";
import type { DedupeRule } from "../../src/sourcing/types.ts";

describe("normalizeUrl", () => {
  test("lowercases scheme and host, drops trailing slash", () => {
    expect(normalizeUrl("HTTPS://Reuters.COM/Article/")).toBe(
      "https://reuters.com/Article"
    );
  });

  test("removes url fragments", () => {
    expect(normalizeUrl("https://a.com/x#section-2")).toBe("https://a.com/x");
  });

  test("removes UTM and tracking query parameters", () => {
    expect(
      normalizeUrl("https://a.com/x?utm_source=nl&utm_medium=email&id=42")
    ).toBe("https://a.com/x?id=42");
  });

  test("sorts remaining query parameters deterministically", () => {
    expect(normalizeUrl("https://a.com/x?b=2&a=1")).toBe(
      normalizeUrl("https://a.com/x?a=1&b=2")
    );
  });

  test("strips both fragment and tracking params in one pass", () => {
    expect(
      normalizeUrl("https://a.com/x?utm_source=nl&id=42#top")
    ).toBe("https://a.com/x?id=42");
  });

  test("gracefully lowercases an unparseable URL", () => {
    expect(normalizeUrl("not-a-URL")).toBe("not-a-url");
  });

  test("preserves the root '/' path", () => {
    expect(normalizeUrl("https://a.com/")).toBe("https://a.com/");
  });
});

describe("levenshtein", () => {
  test("equal strings have distance 0", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
  });

  test("empty vs non-empty", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("abc", "")).toBe(3);
  });

  test("single-character edits", () => {
    expect(levenshtein("kitten", "sitten")).toBe(1); // substitution
    expect(levenshtein("kitten", "kittens")).toBe(1); // insertion
    expect(levenshtein("kittens", "kitten")).toBe(1); // deletion
  });

  test("classic 'kitten' vs 'sitting'", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
  });
});

describe("isDuplicate", () => {
  test("identical strings are always duplicates", () => {
    expect(isDuplicate("https://a.com/x", "https://a.com/x", 0.85)).toBe(true);
  });

  test("threshold of 1 disables fuzzy matching", () => {
    expect(isDuplicate("https://a.com/x", "https://a.com/y", 1.0)).toBe(false);
  });

  test("threshold of 0 collapses everything to duplicate", () => {
    expect(isDuplicate("aaa", "zzzzz", 0.0)).toBe(true);
  });

  test("near-identical URLs are duplicates at threshold 0.85", () => {
    // 1 char difference out of ~40 → ratio ≈ 0.025 < 1 - 0.85 = 0.15
    const a = "https://reuters.com/article/some-story";
    const b = "https://reuters.com/article/some-storY";
    expect(isDuplicate(a, b, 0.85)).toBe(true);
  });

  test("clearly different URLs are not duplicates at threshold 0.85", () => {
    const a = "https://reuters.com/article/some-story";
    const b = "https://bloomberg.com/news/entirely-different-topic";
    expect(isDuplicate(a, b, 0.85)).toBe(false);
  });
});

describe("InMemorySourcingAccumulator", () => {
  const RULE: DedupeRule = { cross_agent: true, similarity_threshold: 0.85 };

  test("records a new URL and returns null", () => {
    const acc = new InMemorySourcingAccumulator(RULE);
    expect(acc.record("https://a.com/x", "research", 0)).toBeNull();
    expect(acc.size()).toBe(1);
  });

  test("does not flag same-agent duplicates", () => {
    const acc = new InMemorySourcingAccumulator(RULE);
    acc.record("https://a.com/x", "research", 0);
    expect(acc.record("https://a.com/x", "research", 1)).toBeNull();
  });

  test("flags cross-agent exact duplicates", () => {
    const acc = new InMemorySourcingAccumulator(RULE);
    acc.record("https://a.com/x", "research", 0);
    const prev = acc.record("https://a.com/x", "stakeholder", 0);
    expect(prev).not.toBeNull();
    expect(prev!.agent).toBe("research");
    expect(prev!.item_index).toBe(0);
  });

  test("flags cross-agent near-duplicates via similarity", () => {
    const acc = new InMemorySourcingAccumulator(RULE);
    acc.record("https://reuters.com/article/some-story", "research", 0);
    const prev = acc.record(
      "https://reuters.com/article/some-storY",
      "stakeholder",
      0
    );
    expect(prev).not.toBeNull();
    expect(prev!.agent).toBe("research");
  });

  test("normalises URLs before comparing (utm stripping)", () => {
    const acc = new InMemorySourcingAccumulator(RULE);
    acc.record("https://a.com/x", "research", 0);
    const prev = acc.record(
      "https://a.com/x?utm_source=nl",
      "stakeholder",
      0
    );
    expect(prev).not.toBeNull();
  });

  test("does not flag cross-agent when cross_agent=false", () => {
    const acc = new InMemorySourcingAccumulator({
      cross_agent: false,
      similarity_threshold: 0.85,
    });
    acc.record("https://a.com/x", "research", 0);
    expect(acc.record("https://a.com/x", "stakeholder", 0)).toBeNull();
  });

  test("entries() exposes every recorded URL", () => {
    const acc = new InMemorySourcingAccumulator(RULE);
    acc.record("https://a.com/x", "research", 0);
    acc.record("https://b.com/y", "stakeholder", 0);
    expect(acc.entries().length).toBe(2);
    expect(acc.entries()[0]!.url).toBe("https://a.com/x");
    expect(acc.entries()[1]!.agent).toBe("stakeholder");
  });
});

describe("NoopSourcingAccumulator", () => {
  test("never reports a duplicate but records the entry", () => {
    const acc = new NoopSourcingAccumulator();
    expect(acc.record("https://a.com", "research", 0)).toBeNull();
    expect(acc.record("https://a.com", "stakeholder", 0)).toBeNull();
    expect(acc.size()).toBe(2);
    expect(acc.entries().length).toBe(2);
  });
});
