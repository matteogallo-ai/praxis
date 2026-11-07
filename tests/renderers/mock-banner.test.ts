/**
 * A mock briefing is fixture text: its figures, organisations and URLs are
 * invented, and no search returned its sources. Every output says so at the
 * top, and none counts a fixture source as a verified ("ok") one, so a mock
 * brief copied out of context cannot pass for a real one.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { renderFullBrief } from "../../src/cli/output.ts";
import { renderSourcingReport } from "../../src/cli/output.ts";
import { renderSourcingReportMarkdown } from "../../src/cli/commands/brief.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { Orchestrator, type BriefResult } from "../../src/orchestrator/orchestrator.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { buildDocumentXml } from "../../src/renderers/docx-internals/document-xml.ts";
import { renderMarkdownEnhanced } from "../../src/renderers/markdown-enhanced.ts";
import { MOCK_BANNER } from "../../src/renderers/mock.ts";
import { pdfRenderer } from "../../src/renderers/pdf.ts";
import { pdfPages } from "../helpers/pdf-text.ts";

const FIXTURES = join(import.meta.dir, "..", "fixtures", "mock-llm");

let mock: BriefResult;
let live: BriefResult;

beforeAll(async () => {
  const registry = new FormatRegistry();
  registry.loadDirectory("formats");
  const orchestrator = new Orchestrator(registry, new MockLLMProvider({ fixturesDir: FIXTURES }));
  mock = await orchestrator.brief("Should we enter the German market?", "mckinsey-style-note");
  // The same text attributed to a real provider: what a live run looks like.
  live = { ...mock, provider_name: "anthropic" };
});

describe("mock outputs carry the fictitious-data banner", () => {
  test("the banner text", () => {
    expect(MOCK_BANNER).toStartWith("DONNÉES FICTIVES — mode mock");
  });

  test("CLI Markdown: right after the front-matter, before the title", () => {
    const md = renderFullBrief(mock);
    const body = md.slice(md.indexOf("---\n\n") + 5);
    expect(body.startsWith(`> **${MOCK_BANNER}**`)).toBe(true);
    expect(renderFullBrief(live)).not.toContain("DONNÉES FICTIVES");
  });

  test("enhanced Markdown", () => {
    const md = renderMarkdownEnhanced(mock, {});
    const body = md.slice(md.indexOf("---\n\n") + 5);
    expect(body.startsWith(`> **${MOCK_BANNER}**`)).toBe(true);
    expect(renderMarkdownEnhanced(live, {})).not.toContain("DONNÉES FICTIVES");
  });

  test("PDF: on the first page, above the title", async () => {
    const text = async (b: BriefResult) =>
      pdfPages(await pdfRenderer.render(b, { compress_pdf_streams: false }))
        .map((page) => page.map((r) => r.text).join(" "));
    const [first = ""] = await text(mock);
    // pdf-text decodes runs as Latin-1, so the WinAnsi em dash (0x97) is lost.
    expect(first).toMatch(/^DONNÉES FICTIVES \S* ?mode mock /);
    expect(first.indexOf("DONNÉES FICTIVES")).toBeLessThan(first.indexOf("Should we enter"));
    expect((await text(live)).join(" ")).not.toContain("DONNÉES FICTIVES");
  });

  test("DOCX: the first paragraph", () => {
    const xml = buildDocumentXml(mock, {});
    const firstText = /<w:t[^>]*>([^<]*)<\/w:t>/.exec(xml)?.[1];
    expect(firstText).toContain("DONNÉES FICTIVES — mode mock");
    expect(buildDocumentXml(live, {})).not.toContain("DONNÉES FICTIVES");
  });
});

describe("mock sourcing counts verify nothing", () => {
  test("the fixture run has sources the rules accept", () => {
    expect(mock.sourcing_report.counts.ok).toBeGreaterThan(0);
  });

  test("front-matter summary: ok=0, the rest counted as unverified", () => {
    const ok = mock.sourcing_report.counts.ok;
    for (const md of [renderFullBrief(mock), renderMarkdownEnhanced(mock, {})]) {
      expect(md).toContain(`sourcing_summary: "mock, not verified: total=${mock.sourcing_report.total_items} ok=0 unverified=${ok} `);
    }
    expect(renderFullBrief(live)).toContain(`ok=${ok} `);
    expect(renderFullBrief(live)).not.toContain("unverified=");
  });

  test("the CLI sourcing reports, Markdown and terminal", () => {
    const ok = mock.sourcing_report.counts.ok;
    expect(renderSourcingReportMarkdown(mock.sourcing_report, mock.provider_name)).toContain(
      `**Counts:** ok 0 · unverified (mock fixtures) ${ok} · stale`
    );
    expect(renderSourcingReport(mock.sourcing_report, mock.provider_name)).toContain(
      `OK: 0  |  Unverified (mock fixtures): ${ok}  |`
    );
    expect(renderSourcingReportMarkdown(live.sourcing_report, live.provider_name)).toContain(`**Counts:** ok ${ok} · stale`);
  });

  test("PDF and DOCX sourcing sections", async () => {
    const ok = mock.sourcing_report.counts.ok;
    const opts = { include_sourcing_report: true, compress_pdf_streams: false };
    const pdf = pdfPages(await pdfRenderer.render(mock, opts)).flat().map((r) => r.text).join(" ");
    expect(pdf).toContain(`OK: 0 · unverified (mock fixtures): ${ok} ·`);
    expect(buildDocumentXml(mock, opts)).toContain(`OK: 0, unverified (mock fixtures): ${ok}, stale:`);
  });
});
