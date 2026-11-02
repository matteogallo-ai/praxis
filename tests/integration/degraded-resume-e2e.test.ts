/**
 * End to end through the CLI: a strict briefing that degrades (one research
 * finding unsourced, ADR 0002) fails at stage 5, then is resumed. The
 * resumed briefing carries exactly one "Insufficiently sourced" section and
 * the flag, makes no call for stages 1–4, and matches an uninterrupted
 * degraded run.
 *
 * Fixtures: tests/fixtures/mock-llm/ with
 * tests/fixtures/degraded-sourcing/research-executive-pre-read.json laid over it.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBriefCli } from "../../src/cli/commands/brief.ts";
import { setColorEnabled } from "../../src/cli/output.ts";
import { INSUFFICIENTLY_SOURCED_SECTION_ID } from "../../src/sourcing/insufficient.ts";
import type { BriefResult } from "../../src/orchestrator/orchestrator.ts";

const QUESTION = "Should we enter the German market?";
const FORMAT = "executive-pre-read";

let saved: { out: typeof process.stdout.write; err: typeof process.stderr.write };
beforeEach(() => {
  setColorEnabled(false);
  saved = { out: process.stdout.write, err: process.stderr.write };
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
});
afterEach(() => {
  process.stdout.write = saved.out;
  process.stderr.write = saved.err;
});

/** The mock fixtures with the degraded research answer, and optionally a broken options answer. */
function degradedFixtures(breakOptions: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-degraded-"));
  cpSync("tests/fixtures/mock-llm", dir, { recursive: true });
  cpSync("tests/fixtures/degraded-sourcing", dir, { recursive: true });
  if (breakOptions) {
    const path = join(dir, `options-${FORMAT}.json`);
    const fixture = JSON.parse(readFileSync(path, "utf-8"));
    writeFileSync(path, JSON.stringify({ ...fixture, response: "not JSON" }));
  }
  return dir;
}

async function fullRun(args: string[], fixturesDir: string): Promise<number> {
  return runBriefCli(args, { formatsDir: "formats", fixturesDir });
}

describe("resuming a degraded briefing", () => {
  test("one Insufficiently sourced section, no rerun of stages 1–4, same briefing as without the failure", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const base = [QUESTION, "--format", FORMAT, "--full", "--runs-dir", runsDir];
    expect(await fullRun(base, degradedFixtures(true))).toBe(1);

    const runId = readdirSync(runsDir)[0]!;
    const dir = join(runsDir, runId);
    const failed = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"));

    const out = join(dir, "brief.json");
    expect(await fullRun(["--resume", runId, "--runs-dir", runsDir, "--json", "--output", out], degradedFixtures(false))).toBe(0);
    const resumed = JSON.parse(readFileSync(out, "utf-8")) as BriefResult;
    const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"));

    expect(resumed.sourcing_report.insufficiently_sourced).toBe(true);
    const flagged = resumed.synthesis.sections.filter((s) => s.section_id === INSUFFICIENTLY_SOURCED_SECTION_ID);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.content_markdown).toContain("**Research finding 2**");
    // The degraded section is added after the synthesis checkpoint, never stored in it.
    const stored = JSON.parse(readFileSync(join(dir, "synthesis.json"), "utf-8"));
    expect(stored.sections.map((s: { section_id: string }) => s.section_id)).not.toContain(INSUFFICIENTLY_SOURCED_SECTION_ID);
    for (const stage of ["scoping", "research", "stakeholder", "risk"]) {
      expect(meta.usage.stages[stage].calls).toBe(failed.usage.stages[stage].calls);
    }

    const freshRuns = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const freshOut = join(freshRuns, "brief.json");
    expect(
      await fullRun([QUESTION, "--format", FORMAT, "--full", "--runs-dir", freshRuns, "--json", "--output", freshOut], degradedFixtures(false))
    ).toBe(0);
    const fresh = JSON.parse(readFileSync(freshOut, "utf-8")) as BriefResult;
    expect(resumed.synthesis).toEqual(fresh.synthesis);
    expect(resumed.sourcing_report).toEqual(fresh.sourcing_report);
  });
});
