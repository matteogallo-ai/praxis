/**
 * Live end-to-end integration test for the v0.7 seven-agent pipeline
 * with critique, rendered to Markdown, DOCX, and PDF for human
 * inspection.
 *
 * SKIPPED unless `ANTHROPIC_API_KEY` is set. When run, writes:
 *
 *   /tmp/praxis-live-brief-with-critique-<ts>.md
 *   /tmp/praxis-live-brief-with-critique-<ts>.docx
 *   /tmp/praxis-live-brief-with-critique-<ts>.pdf
 *
 * for post-hoc human review across the three deliverable formats.
 */

import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";

import { FormatRegistry } from "../../src/registry/registry.ts";
import { AnthropicLLMProvider } from "../../src/llm/anthropic-provider.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { render } from "../../src/renderers/index.ts";

const hasKey =
  typeof process.env["ANTHROPIC_API_KEY"] === "string" &&
  process.env["ANTHROPIC_API_KEY"]!.length > 0;

describe.skipIf(!hasKey)("Full brief with critique + renderers (live)", () => {
  test("briefWithCritique + renderers land on disk in md/docx/pdf", async () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    const llm = new AnthropicLLMProvider();
    const orch = new Orchestrator(registry, llm);

    const out = await orch.briefWithCritique(
      "Should we enter the German mid-market SaaS space in 2026?",
      "executive-pre-read",
      {
        researchMaxToolRounds: 4,
        stakeholderMaxToolRounds: 4,
        riskMaxToolRounds: 4,
        optionsMaxToolRounds: 4,
        adversarialMaxToolRounds: 4,
      }
    );

    expect(out.adversarial.critiques.length).toBeGreaterThanOrEqual(3);

    const ts = Date.now();
    const format = registry.get("executive-pre-read");

    const md = await render(out, "md-enhanced", format, {
      include_critique: true,
      include_toc: true,
      include_appendices: true,
    });
    const mdPath = `/tmp/praxis-live-brief-with-critique-${ts}.md`;
    writeFileSync(mdPath, md);
    expect(md.length).toBeGreaterThan(1024);

    const pdf = await render(out, "pdf", format, {
      include_critique: true,
      include_toc: true,
      include_appendices: true,
      theme: "consulting",
    });
    const pdfPath = `/tmp/praxis-live-brief-with-critique-${ts}.pdf`;
    writeFileSync(pdfPath, pdf);
    expect(pdf.slice(0, 5).toString("ascii")).toBe("%PDF-");

    // executive-pre-read does not declare docx in output_targets;
    // use mckinsey-style-note for the DOCX one.
    const outMk = await orch.briefWithCritique(
      "Should we enter Germany?",
      "mckinsey-style-note",
      { adversarialMaxToolRounds: 4 }
    );
    const formatMk = registry.get("mckinsey-style-note");
    const docx = await render(outMk, "docx", formatMk, {
      include_critique: true,
    });
    const docxPath = `/tmp/praxis-live-brief-with-critique-${ts}.docx`;
    writeFileSync(docxPath, docx);
    // ZIP magic PK\x03\x04.
    expect(docx[0]).toBe(0x50);
    expect(docx[1]).toBe(0x4b);
  }, 900_000);
});
