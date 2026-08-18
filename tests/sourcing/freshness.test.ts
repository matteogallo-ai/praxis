import { describe, expect, test } from "bun:test";

import {
  ageInDays,
  classifyFreshness,
} from "../../src/sourcing/freshness.ts";
import type { FreshnessRule } from "../../src/sourcing/types.ts";

const RULE: FreshnessRule = {
  max_source_age_days: 730,
  warn_after_days: 365,
};

// Pinned "now" so every age computation is deterministic.
const NOW = new Date("2026-08-18T00:00:00Z");

describe("ageInDays", () => {
  test("returns 0 for a timestamp identical to now", () => {
    expect(ageInDays("2026-08-18T00:00:00Z", NOW)).toBe(0);
  });

  test("returns a positive integer for a past timestamp", () => {
    expect(ageInDays("2025-08-18T00:00:00Z", NOW)).toBe(365);
  });

  test("floors fractional days", () => {
    expect(ageInDays("2026-08-17T12:00:00Z", NOW)).toBe(0);
  });

  test("returns 0 for a future timestamp (clock skew, not stale)", () => {
    expect(ageInDays("2027-01-01T00:00:00Z", NOW)).toBe(0);
  });

  test("returns +Infinity for a malformed timestamp", () => {
    expect(ageInDays("not-a-date", NOW)).toBe(Number.POSITIVE_INFINITY);
    expect(ageInDays("", NOW)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("classifyFreshness", () => {
  test("classifies a very recent source as fresh", () => {
    const r = classifyFreshness("2026-08-01T00:00:00Z", RULE, NOW);
    expect(r.classification).toBe("fresh");
    expect(r.age_days).toBe(17);
  });

  test("classifies a source at warn_after_days exactly as fresh (boundary)", () => {
    // Exactly warn_after_days (365) is NOT older than warn_after_days.
    const r = classifyFreshness("2025-08-18T00:00:00Z", RULE, NOW);
    expect(r.classification).toBe("fresh");
    expect(r.age_days).toBe(365);
  });

  test("classifies a source older than warn_after_days but within max as warn", () => {
    const r = classifyFreshness("2025-08-01T00:00:00Z", RULE, NOW);
    expect(r.classification).toBe("warn");
    expect(r.age_days).toBeGreaterThan(365);
    expect(r.age_days).toBeLessThan(730);
  });

  test("classifies a source at max_source_age_days exactly as warn (boundary)", () => {
    const r = classifyFreshness("2024-08-18T00:00:00Z", RULE, NOW);
    expect(r.classification).toBe("warn");
    expect(r.age_days).toBe(730);
  });

  test("classifies a source older than max_source_age_days as stale", () => {
    const r = classifyFreshness("2020-01-01T00:00:00Z", RULE, NOW);
    expect(r.classification).toBe("stale");
    expect(r.age_days).toBeGreaterThan(730);
  });

  test("classifies a malformed timestamp as stale", () => {
    const r = classifyFreshness("not-a-date", RULE, NOW);
    expect(r.classification).toBe("stale");
    expect(r.age_days).toBe(Number.POSITIVE_INFINITY);
  });
});
