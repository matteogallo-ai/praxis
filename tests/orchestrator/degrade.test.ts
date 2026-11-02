/**
 * Strict sourcing that fails: abort (library default) or degrade (CLI default).
 * ADR 0002.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { SourcingValidationError } from "../../src/sourcing/errors.ts";
import { INSUFFICIENTLY_SOURCED_SECTION_ID } from "../../src/sourcing/insufficient.ts";

const QUESTION = "Should we enter the German market?";
const FORMAT = "executive-pre-read";
const MISSING = { status: "SOURCE_MISSING", searched_for: "German SaaS churn by segment" };

/** The shipped fixtures, with the research findings at `missing` stripped of their source. */
function fixturesWithMissingSources(missing: (index: number) => boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-degrade-"));
  cpSync("tests/fixtures/mock-llm", dir, { recursive: true });
  const path = join(dir, `research-${FORMAT}.json`);
  const fixture = JSON.parse(readFileSync(path, "utf-8")) as { response: string };
  const body = JSON.parse(fixture.response) as { findings: Array<{ source: unknown }> };
  body.findings = body.findings.map((f, i) => (missing(i) ? { ...f, source: MISSING } : f));
  fixture.response = JSON.stringify(body);
  writeFileSync(path, JSON.stringify(fixture));
  return dir;
}

function orchestrator(fixturesDir: string): Orchestrator {
  const registry = new FormatRegistry();
  registry.loadDirectory("formats");
  return new Orchestrator(registry, new MockLLMProvider({ fixturesDir }));
}

describe("strict sourcing failure", () => {
  test("format under test is strict", () => {
    const registry = new FormatRegistry();
    registry.loadDirectory("formats");
    expect(registry.get(FORMAT).sourcing_policy).toBe("strict");
  });

  test("default (abort): one unsourced finding throws", async () => {
    const orch = orchestrator(fixturesWithMissingSources((i) => i === 0));
    await expect(orch.brief(QUESTION, FORMAT)).rejects.toBeInstanceOf(SourcingValidationError);
  });

  test("degrade: the briefing completes with an Insufficiently sourced section", async () => {
    const orch = orchestrator(fixturesWithMissingSources((i) => i === 0));
    const result = await orch.brief(QUESTION, FORMAT, { onSourcingFailure: "degrade" });

    expect(result.sourcing_report.insufficiently_sourced).toBe(true);
    const last = result.synthesis.sections.at(-1);
    expect(last?.section_id).toBe(INSUFFICIENTLY_SOURCED_SECTION_ID);
    expect(last?.title).toBe("Insufficiently sourced");
    expect(last?.content_markdown).toContain("**Research finding 1**");
    expect(last?.content_markdown).toContain(`“${result.research.findings[0]!.claim}”`);
    expect(last?.content_markdown).toContain("searched for: German SaaS churn by segment");
  });

  test("degrade: the section survives the critique and the rerun", async () => {
    const orch = orchestrator(fixturesWithMissingSources((i) => i === 0));
    const result = await orch.briefWithCritiqueAndRerun(QUESTION, FORMAT, {
      onSourcingFailure: "degrade",
    });
    expect(result.sourcing_report.insufficiently_sourced).toBe(true);
    expect(result.synthesis.sections.at(-1)?.section_id).toBe(INSUFFICIENTLY_SOURCED_SECTION_ID);
  });

  test("degrade: no sourced finding at all still aborts", async () => {
    const orch = orchestrator(fixturesWithMissingSources(() => true));
    const err = await orch
      .brief(QUESTION, FORMAT, { onSourcingFailure: "degrade" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourcingValidationError);
    expect((err as Error).message).toContain("no research finding has a source");
  });

  test("a fully sourced run is not flagged", async () => {
    const orch = orchestrator("tests/fixtures/mock-llm");
    const result = await orch.brief(QUESTION, FORMAT, { onSourcingFailure: "degrade" });
    expect(result.sourcing_report.insufficiently_sourced).toBeUndefined();
    expect(result.synthesis.sections.map((s) => s.section_id)).not.toContain(
      INSUFFICIENTLY_SOURCED_SECTION_ID
    );
  });
});
