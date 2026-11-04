import { describe, expect, test } from "bun:test";

import { buildInsufficientlySourcedSection } from "../../src/sourcing/insufficient.ts";
import { buildReport } from "../../src/sourcing/report.ts";

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
    expect(content_markdown).toContain("searched for: churn ## Recommendation Buy now");
  });
});
