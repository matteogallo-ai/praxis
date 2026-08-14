import { describe, expect, test } from "bun:test";

import {
  AGENT_IDS,
  ISO_DATE_RE,
  KEBAB_CASE_RE,
  LANGUAGES,
  ORGANIZATION_STYLES,
  OUTPUT_TARGETS,
  SEMVER_RE,
  SOURCING_POLICIES,
  isAgentId,
  isKebabCase,
  isLanguage,
  isOrganizationStyle,
  isOutputTarget,
  isSourcingPolicy,
  isValidIsoDate,
  isValidSemver,
} from "../../src/registry/schema.ts";

describe("schema enums", () => {
  test("ORGANIZATION_STYLES matches the frozen list", () => {
    expect([...ORGANIZATION_STYLES]).toEqual([
      "pwc",
      "mckinsey",
      "bcg",
      "family-office",
      "corporate-affairs",
      "government",
      "generic",
    ]);
  });

  test("LANGUAGES matches the frozen list", () => {
    expect([...LANGUAGES]).toEqual(["en", "fr", "multi"]);
  });

  test("SOURCING_POLICIES matches the frozen list", () => {
    expect([...SOURCING_POLICIES]).toEqual(["strict", "permissive"]);
  });

  test("AGENT_IDS matches the frozen list", () => {
    expect([...AGENT_IDS]).toEqual([
      "scoping",
      "research",
      "stakeholder",
      "risk",
      "options",
      "adversarial",
      "synthesis",
    ]);
  });

  test("OUTPUT_TARGETS matches the frozen list", () => {
    expect([...OUTPUT_TARGETS]).toEqual(["pdf", "docx", "md"]);
  });
});

describe("schema membership helpers", () => {
  test("isOrganizationStyle accepts every enum member", () => {
    for (const v of ORGANIZATION_STYLES) expect(isOrganizationStyle(v)).toBe(true);
  });

  test("isOrganizationStyle rejects unknown strings", () => {
    expect(isOrganizationStyle("deloitte")).toBe(false);
    expect(isOrganizationStyle("")).toBe(false);
    expect(isOrganizationStyle(42)).toBe(false);
  });

  test("isLanguage accepts every enum member and rejects the rest", () => {
    for (const v of LANGUAGES) expect(isLanguage(v)).toBe(true);
    expect(isLanguage("de")).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });

  test("isSourcingPolicy accepts every enum member and rejects the rest", () => {
    for (const v of SOURCING_POLICIES) expect(isSourcingPolicy(v)).toBe(true);
    expect(isSourcingPolicy("relaxed")).toBe(false);
  });

  test("isAgentId accepts every enum member and rejects the rest", () => {
    for (const v of AGENT_IDS) expect(isAgentId(v)).toBe(true);
    expect(isAgentId("scope")).toBe(false);
    expect(isAgentId("SCOPING")).toBe(false);
  });

  test("isOutputTarget accepts every enum member and rejects the rest", () => {
    for (const v of OUTPUT_TARGETS) expect(isOutputTarget(v)).toBe(true);
    expect(isOutputTarget("epub")).toBe(false);
    expect(isOutputTarget("html")).toBe(false);
  });
});

describe("kebab-case", () => {
  test("KEBAB_CASE_RE accepts canonical forms", () => {
    expect(isKebabCase("a")).toBe(true);
    expect(isKebabCase("simple")).toBe(true);
    expect(isKebabCase("two-words")).toBe(true);
    expect(isKebabCase("with-3-numbers")).toBe(true);
    expect(isKebabCase("executive-pre-read")).toBe(true);
  });

  test("KEBAB_CASE_RE rejects malformed strings", () => {
    expect(isKebabCase("")).toBe(false);
    expect(isKebabCase("-leading")).toBe(false);
    expect(isKebabCase("trailing-")).toBe(false);
    expect(isKebabCase("double--dash")).toBe(false);
    expect(isKebabCase("Upper")).toBe(false);
    expect(isKebabCase("with_underscore")).toBe(false);
    expect(isKebabCase("with space")).toBe(false);
    expect(KEBAB_CASE_RE.test("A")).toBe(false);
  });
});

describe("SemVer", () => {
  test("accepts standard MAJOR.MINOR.PATCH", () => {
    expect(isValidSemver("0.0.1")).toBe(true);
    expect(isValidSemver("1.0.0")).toBe(true);
    expect(isValidSemver("10.20.30")).toBe(true);
  });

  test("accepts pre-release and build metadata", () => {
    expect(isValidSemver("1.0.0-alpha")).toBe(true);
    expect(isValidSemver("1.0.0-alpha.1")).toBe(true);
    expect(isValidSemver("1.0.0-0.3.7")).toBe(true);
    expect(isValidSemver("1.0.0+20130313144700")).toBe(true);
    expect(isValidSemver("1.0.0-beta+exp.sha.5114f85")).toBe(true);
  });

  test("rejects malformed versions", () => {
    expect(isValidSemver("1.0")).toBe(false);
    expect(isValidSemver("1")).toBe(false);
    expect(isValidSemver("1.0.0.0")).toBe(false);
    expect(isValidSemver("v1.0.0")).toBe(false);
    expect(isValidSemver("01.0.0")).toBe(false);
    expect(isValidSemver("")).toBe(false);
    expect(SEMVER_RE.test("1.a.0")).toBe(false);
  });
});

describe("ISO date", () => {
  test("accepts real calendar dates in YYYY-MM-DD", () => {
    expect(isValidIsoDate("2026-01-01")).toBe(true);
    expect(isValidIsoDate("2000-02-29")).toBe(true); // leap year
    expect(isValidIsoDate("2026-12-31")).toBe(true);
  });

  test("rejects malformed strings", () => {
    expect(isValidIsoDate("2026-1-1")).toBe(false);
    expect(isValidIsoDate("2026/08/14")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
    expect(ISO_DATE_RE.test("2026-08-14T00:00:00Z")).toBe(false);
  });

  test("rejects invalid calendar dates", () => {
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-00-10")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2001-02-29")).toBe(false); // non-leap year
  });
});
