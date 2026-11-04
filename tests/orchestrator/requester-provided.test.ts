/**
 * Facts that concern only the requester cannot be sourced: the scoping stage
 * names them, the briefing lists them as such, and the sourcing report counts
 * them apart, never among the sourced items.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { renderMarkdownEnhanced } from "../../src/renderers/markdown-enhanced.ts";
import { REQUESTER_PROVIDED_SECTION_ID } from "../../src/sourcing/requester.ts";
import { FIXTURE_CLOCK } from "../fixtures/clock.ts";

const NOW = new Date(FIXTURE_CLOCK);
const QUESTION = "Should we enter the German market?";
const FORMAT = "executive-pre-read";
const FACTS = ["Our current EBITDA margin and cash available for the entry", "Our board's appetite for a 24-month payback"];

/** The shipped fixtures, with the scoping answer naming `facts` as requester-provided. */
function fixtures(facts: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-requester-"));
  cpSync("tests/fixtures/mock-llm", dir, { recursive: true });
  const path = join(dir, `scoping-${FORMAT}.json`);
  const fixture = JSON.parse(readFileSync(path, "utf-8")) as { response: string };
  fixture.response = JSON.stringify({ ...JSON.parse(fixture.response), requester_provided: facts });
  writeFileSync(path, JSON.stringify(fixture));
  return dir;
}

function orchestrator(fixturesDir: string): Orchestrator {
  const registry = new FormatRegistry();
  registry.loadDirectory("formats");
  return new Orchestrator(registry, new MockLLMProvider({ fixturesDir }));
}

describe("requester-provided facts", () => {
  test("are counted apart and never among the sourced items", async () => {
    const without = await orchestrator("tests/fixtures/mock-llm").brief(QUESTION, FORMAT, { now: NOW });
    const withFacts = await orchestrator(fixtures(FACTS)).brief(QUESTION, FORMAT, { now: NOW });

    expect(withFacts.sourcing_report.requester_provided).toBe(2);
    // Same items, same categories: the facts are added to none of them.
    expect(withFacts.sourcing_report.total_items).toBe(without.sourcing_report.total_items);
    expect(withFacts.sourcing_report.counts).toEqual(without.sourcing_report.counts);
    expect(without.sourcing_report).not.toHaveProperty("requester_provided");
  });

  test("are listed in the briefing as not sourceable, by code", async () => {
    const result = await orchestrator(fixtures(FACTS)).brief(QUESTION, FORMAT, { now: NOW });
    const section = result.synthesis.sections.find((s) => s.section_id === REQUESTER_PROVIDED_SECTION_ID);
    expect(section?.title).toBe("Requester-provided, not sourceable");
    for (const fact of FACTS) expect(section?.content_markdown).toContain(`- ${fact}`);
    expect(section?.sources_cited).toEqual([]);

    const md = renderMarkdownEnhanced(result);
    expect(md).toContain("## Requester-provided, not sourceable");
    expect(md).toMatch(/sourcing_summary: "[^"]* requester_provided=2[^"]*"/);
  });

  test("an empty list adds no section but still says none were needed", async () => {
    const result = await orchestrator(fixtures([])).brief(QUESTION, FORMAT, { now: NOW });
    expect(result.sourcing_report.requester_provided).toBe(0);
    expect(result.synthesis.sections.map((s) => s.section_id)).not.toContain(REQUESTER_PROVIDED_SECTION_ID);
  });

  test("the section survives the critique's rerun", async () => {
    const result = await orchestrator(fixtures(FACTS)).briefWithCritiqueAndRerun(QUESTION, FORMAT, { now: NOW });
    expect(result.rerun_performed).toBe(true);
    expect(result.synthesis.sections.map((s) => s.section_id)).toContain(REQUESTER_PROVIDED_SECTION_ID);
    expect(result.sourcing_report.requester_provided).toBe(2);
  });
});
