/**
 * Live end-to-end integration test for the v0.6 full brief pipeline:
 * Scoping → Research → Stakeholders → Risks → Options → Synthesis.
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set. When run, writes a full
 * Markdown briefing to /tmp for human inspection.
 */

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";

import { FormatRegistry } from "../../src/registry/registry.ts";
import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { renderFullBrief } from "../../src/cli/output.ts";

const hasKey =
  typeof process.env["ANTHROPIC_API_KEY"] === "string" &&
  process.env["ANTHROPIC_API_KEY"]!.length > 0;

describe.skipIf(!hasKey)("Full brief pipeline (live, executive-pre-read)", () => {
  test("brief() returns a complete BriefResult and the Markdown renders", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const llm = new AnthropicLLMProvider();
    const orch = new Orchestrator(registry, llm);

    const out = await orch.brief(
      "Should we enter the German mid-market SaaS space in 2026?",
      "executive-pre-read",
      {
        researchMaxToolRounds: 4,
        stakeholderMaxToolRounds: 4,
        riskMaxToolRounds: 4,
        optionsMaxToolRounds: 4,
      }
    );

    expect(out.scoping.reformulated_question.length).toBeGreaterThan(10);
    expect(out.research.findings.length).toBeGreaterThanOrEqual(1);
    expect(out.stakeholders.stakeholders.length).toBeGreaterThanOrEqual(3);
    expect(out.risks.risks.length).toBeGreaterThanOrEqual(3);
    expect(out.options.options.length).toBeGreaterThanOrEqual(2);
    expect(out.synthesis.sections.length).toBe(6);
    expect(out.sourcing_report.total_items).toBeGreaterThan(0);

    // Recommended option is unique and referenced.
    const recs = out.options.options.filter(
      (o) => o.recommendation_level === "recommended"
    );
    expect(recs).toHaveLength(1);
    expect(recs[0]!.id).toBe(out.options.recommended_option_id);

    // Render and drop to /tmp for post-hoc human audit.
    const md = renderFullBrief(out);
    const path = `/tmp/praxis-live-brief-${Date.now()}.md`;
    writeFileSync(path, md, "utf-8");
    // No hard assertion beyond writability — a human reviews the Markdown.
    expect(md.startsWith("---\n")).toBe(true);
  }, 900_000);
});
