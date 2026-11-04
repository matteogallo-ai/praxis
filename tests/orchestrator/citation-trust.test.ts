/**
 * Domain trust on the citations of the options and adversarial stages, which
 * the per-item validators of stages 2–4 never see.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockLLMProvider } from "../../src/llm/mock-provider.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { FormatRegistry } from "../../src/registry/registry.ts";
import { UntrustedDomainError } from "../../src/sourcing/errors.ts";
import { INSUFFICIENTLY_SOURCED_SECTION_ID } from "../../src/sourcing/insufficient.ts";
import { FIXTURE_CLOCK } from "../fixtures/clock.ts";

const NOW = new Date(FIXTURE_CLOCK);
const QUESTION = "Should we enter the German market?";
const FORMAT = "executive-pre-read";
const UNTRUSTED = "https://growth-hacks.example.net/expansion";

/**
 * The shipped fixtures, with one citation moved to an untrusted host: OPT-B's,
 * the one option citation no synthesis section repeats, or the first critique's.
 */
function fixtures(stage: "options" | "adversarial", patch: Record<string, unknown> = {}, evidence: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-citations-"));
  cpSync("tests/fixtures/mock-llm", dir, { recursive: true });
  const path = join(dir, `${stage}-${FORMAT}.json`);
  const fixture = JSON.parse(readFileSync(path, "utf-8")) as { response: string };
  const body = JSON.parse(fixture.response) as Record<string, Array<Record<string, unknown>>>;
  const [list, field] = stage === "options" ? ["options", "supporting_evidence"] : ["critiques", "counter_evidence"];
  const item = body[list]?.[stage === "options" ? 1 : 0];
  if (item === undefined) throw new Error(`fixture has no ${list} to edit`);
  Object.assign(item, patch);
  item[field] = { ...(item[field] as object), url: UNTRUSTED, ...evidence };
  fixture.response = JSON.stringify(body);
  writeFileSync(path, JSON.stringify(fixture));
  return dir;
}

function orchestrator(fixturesDir: string): Orchestrator {
  const registry = new FormatRegistry();
  registry.loadDirectory("formats");
  return new Orchestrator(registry, new MockLLMProvider({ fixturesDir }));
}

describe("domain trust on options citations", () => {
  test("strict (abort): an untrusted option citation fails the brief", async () => {
    const err = await orchestrator(fixtures("options"))
      .brief(QUESTION, FORMAT, { now: NOW })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UntrustedDomainError);
    expect((err as UntrustedDomainError).report.untrusted_citations).toEqual([
      expect.objectContaining({ stage: "options", id: "OPT-B", url: UNTRUSTED }),
    ]);
  });

  test("strict (degrade): the briefing completes, and its Insufficiently sourced section names the option", async () => {
    const result = await orchestrator(fixtures("options")).brief(QUESTION, FORMAT, {
      onSourcingFailure: "degrade",
      now: NOW,
    });
    expect(result.sourcing_report.insufficiently_sourced).toBe(true);
    const last = result.synthesis.sections.at(-1);
    expect(last?.section_id).toBe(INSUFFICIENTLY_SOURCED_SECTION_ID);
    expect(last?.content_markdown).toContain(`**Option OPT-B**: ${UNTRUSTED} is not a trusted domain`);
  });

  test("trusted citations: an empty list, no flag", async () => {
    const result = await orchestrator("tests/fixtures/mock-llm").brief(QUESTION, FORMAT, { now: NOW });
    expect(result.sourcing_report.untrusted_citations).toEqual([]);
    expect(result.sourcing_report.insufficiently_sourced).toBeUndefined();
  });
});

describe("domain trust on critique citations", () => {
  test("an untrusted counter-evidence is listed, and does not stop the critique", async () => {
    const result = await orchestrator(fixtures("adversarial")).briefWithCritique(QUESTION, FORMAT, { now: NOW });
    const id = result.adversarial.critiques[0]?.id;
    expect(result.sourcing_report.untrusted_citations).toEqual([
      expect.objectContaining({ stage: "adversarial", id, url: UNTRUSTED }),
    ]);
    expect(result.sourcing_report.insufficiently_sourced).toBeUndefined();
  });

  // A steelmanned position is an argument, a judgement: its counter-evidence
  // is never first-party (ADR 0003, amendment of 4 Nov 2026).
  test("a counter-evidence from the organisation's own site, marked first-party, stays an untrusted citation", async () => {
    const dir = fixtures(
      "adversarial",
      { steelmanned_position: "The FCA's own listing rules make a UK dual listing slower and costlier than the brief assumes, which changes its timing." },
      { url: "https://www.fca.org.uk/markets/listing-rules", first_party_for: "Financial Conduct Authority" }
    );
    const result = await orchestrator(dir).briefWithCritique(QUESTION, FORMAT, { now: NOW });
    const id = result.adversarial.critiques[0]?.id ?? "no critique";
    expect(result.sourcing_report.untrusted_citations).toEqual([
      expect.objectContaining({ stage: "adversarial", id, url: "https://www.fca.org.uk/markets/listing-rules" }),
    ]);
    expect(result.sourcing_report).not.toHaveProperty("first_party_sources");
  });

  test("after the rerun, each untrusted citation is listed once", async () => {
    const result = await orchestrator(fixtures("adversarial")).briefWithCritiqueAndRerun(QUESTION, FORMAT, { now: NOW });
    expect(result.rerun_performed).toBe(true);
    expect(result.sourcing_report.untrusted_citations?.map((c) => c.url)).toEqual([UNTRUSTED]);
  });
});
