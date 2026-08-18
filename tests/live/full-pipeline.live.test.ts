/**
 * Live end-to-end integration test for the v0.5 full pipeline:
 * Scoping → Research → Stakeholders → Risks (with hardened sourcing).
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set. When run, writes a JSON
 * report (all four outputs + the sourcing report) to /tmp for
 * post-hoc inspection.
 */

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";

import { FormatRegistry } from "../../src/registry/registry.ts";
import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";

const hasKey =
  typeof process.env["ANTHROPIC_API_KEY"] === "string" &&
  process.env["ANTHROPIC_API_KEY"]!.length > 0;

describe.skipIf(!hasKey)("Full pipeline (live, executive-pre-read)", () => {
  test("assessRisksAfterStakeholders returns four outputs + aggregated sourcing report", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const llm = new AnthropicLLMProvider();
    const orch = new Orchestrator(registry, llm);

    const out = await orch.assessRisksAfterStakeholders(
      "Should we enter the German mid-market SaaS space in 2026?",
      "executive-pre-read",
      {
        riskMaxToolRounds: 4,
        stakeholderMaxToolRounds: 4,
        researchMaxToolRounds: 4,
      }
    );

    expect(out.scoping.reformulated_question.length).toBeGreaterThan(10);
    expect(out.research.findings.length).toBeGreaterThanOrEqual(1);
    expect(out.stakeholders.stakeholders.length).toBeGreaterThanOrEqual(3);
    expect(out.risks.risks.length).toBeGreaterThanOrEqual(3);
    expect(out.sourcing_report.total_items).toBeGreaterThan(0);

    // Drop the whole payload to /tmp for post-hoc audit.
    const path = "/tmp/praxis-live-full-pipeline-report.json";
    writeFileSync(path, JSON.stringify(out, null, 2));
    // The test does not assert on file contents beyond writability.
  }, 600_000);
});
