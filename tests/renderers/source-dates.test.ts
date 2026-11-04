/**
 * A first-party source is listed with the claim it was accepted for, so a
 * human can check that the sentence states the organisation's own fact:
 * the one judgement code cannot make (ADR 0003).
 */
import { describe, expect, test } from "bun:test";

import { CLAIM_MAX, describeFirstParty } from "../../src/renderers/source-dates.ts";

const F = { stage: "research" as const, item: "finding 3", organisation: "IFRS Foundation", url: "https://www.ifrs.org/a" };

describe("describeFirstParty — the claim", () => {
  test("a short claim is quoted whole", () => {
    expect(describeFirstParty({ ...F, claim: "The ISSB amended IFRS S2 in December 2025." })).toBe(
      "[research] finding 3 — IFRS Foundation's own site, for its own facts: https://www.ifrs.org/a — claim: “The ISSB amended IFRS S2 in December 2025.”"
    );
  });

  test("a long claim is cut at a word boundary, with an ellipsis", () => {
    const claim = `${"word ".repeat(60)}end`;
    const quoted = /claim: “(.*)”$/.exec(describeFirstParty({ ...F, claim }))?.[1] as string;
    expect(quoted.endsWith(" …")).toBe(false);
    expect(quoted.endsWith("word…")).toBe(true);
    expect(quoted.length).toBeLessThanOrEqual(CLAIM_MAX + 1);
  });

  test("a single word longer than the limit is cut inside it", () => {
    const quoted = /claim: “(.*)”$/.exec(describeFirstParty({ ...F, claim: "x".repeat(500) }))?.[1] as string;
    expect(quoted).toBe(`${"x".repeat(CLAIM_MAX)}…`);
  });

  test("a claim on several lines is one line", () => {
    expect(describeFirstParty({ ...F, claim: "a\n\n# b" })).toEndWith("claim: “a # b”");
  });

  // Reports stored before the field existed have no claim.
  test("a source without a recorded claim says so", () => {
    expect(describeFirstParty(F)).toEndWith(" — claim not recorded");
  });
});
