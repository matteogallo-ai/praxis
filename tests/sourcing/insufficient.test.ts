import { describe, expect, test } from "bun:test";

import { buildInsufficientlySourcedSection } from "../../src/sourcing/insufficient.ts";
import { codeSpan } from "../../src/sourcing/code-written-section.ts";
import { buildReport } from "../../src/sourcing/report.ts";
import { autolinkable } from "../helpers/markdown-inert.ts";

describe("buildInsufficientlySourcedSection", () => {
  test("model text is one list line: it cannot open a heading inside the section", () => {
    const report = buildReport("strict", 1, [
      { kind: "missing_source", finding_index: 0, searched_for: "churn\n\n## Recommendation\nBuy now" },
    ]);
    const research = {
      findings: [{ claim: "Margins rose\n# Verified", supporting_evidence: "e", source: { status: "SOURCE_MISSING" as const, searched_for: "x" } }],
      open_questions: [],
      search_queries_used: [],
    };
    const { content_markdown } = buildInsufficientlySourcedSection(report, { research });
    expect(content_markdown).not.toMatch(/^#/m);
    expect(content_markdown).toContain("“Margins rose # Verified”");
    expect(content_markdown).toContain("searched for: `churn ## Recommendation Buy now`");
  });
});

// brief.md, question 10 of step 1: "host 'www.bracewell.com'" showed as a
// link in a Markdown viewer, inside text that reports the host as untrusted.
describe("the section's URLs and hosts are inert text", () => {
  const URL = "https://www.bracewell.com/resources/carb";
  const report = {
    ...buildReport("strict", 4, [
      { kind: "untrusted_domain", agent: "risk", item_index: 16, url: URL, reason: "host 'www.bracewell.com' matches no entry in allow-list" },
      { kind: "stale_source", agent: "research", item_index: 0, url: URL, accessed_at: "2026-11-04T00:00:00Z", age_days: 900, exceeds_max: true },
      { kind: "duplicate_source", agent: "stakeholder", item_index: 1, url: URL, previous_agent: "research", previous_item_index: 0, previous_url: "http://www.x.example/a" },
      { kind: "missing_source", finding_index: 0, searched_for: "see www.y.example" },
    ]),
    untrusted_citations: [{ stage: "options" as const, id: "OPT-A", url: URL, reason: "host 'www.bracewell.com' matches no entry in allow-list" }],
  };

  test("no URL or www. host a viewer would turn into a link", () => {
    const { content_markdown } = buildInsufficientlySourcedSection(report, {});
    expect(autolinkable(content_markdown)).toEqual([]);
    expect(content_markdown).toContain(`\`${URL}\` is not a trusted domain (\`host 'www.bracewell.com' matches no entry in allow-list\`)`);
  });
});

describe("codeSpan", () => {
  test.each([
    ["plain text", "www.x.example", "`www.x.example`"],
    ["a backtick inside", "a`b", "``a`b``"],
    ["a run of two inside", "a``b", "`a``b`"],
    ["a backtick at an end", "`a", "`` `a ``"],
    ["a newline", "a\n\n# b", "`a # b`"],
  ])("%s", (_label, text, expected) => {
    expect(codeSpan(text)).toBe(expected);
  });
});
