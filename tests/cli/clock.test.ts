/**
 * The CLI clock: `PRAXIS_NOW` freezes the date a briefing's freshness is
 * judged against and its run id is stamped with. The test preload sets it,
 * so no CLI test reads the wall clock (in process or through a spawned CLI).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBriefCli } from "../../src/cli/commands/brief.ts";
import { setColorEnabled } from "../../src/cli/output.ts";
import { extractRunArgs } from "../../src/cli/run-args.ts";

const ARGS = ["Should we enter the German market?", "--format", "executive-pre-read", "--full"];

let saved: { now: string | undefined; out: typeof process.stdout.write; err: typeof process.stderr.write };
beforeEach(() => {
  setColorEnabled(false);
  saved = { now: process.env["PRAXIS_NOW"], out: process.stdout.write, err: process.stderr.write };
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
});
afterEach(() => {
  if (saved.now === undefined) delete process.env["PRAXIS_NOW"];
  else process.env["PRAXIS_NOW"] = saved.now;
  process.stdout.write = saved.out;
  process.stderr.write = saved.err;
});

describe("PRAXIS_NOW", () => {
  test("is the run's clock", () => {
    process.env["PRAXIS_NOW"] = "2029-01-01T00:00:00Z";
    const parsed = extractRunArgs([]);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.run.now.toISOString()).toBe("2029-01-01T00:00:00.000Z");
  });

  test("absent, the clock is the wall clock", () => {
    delete process.env["PRAXIS_NOW"];
    const before = Date.now();
    const parsed = extractRunArgs([]);
    if ("error" in parsed) throw new Error(parsed.error);
    expect(parsed.run.now.getTime()).toBeGreaterThanOrEqual(before);
    expect(parsed.run.now.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test.each([
    "yesterday",
    "2029-01-01",
    "1735689600",
    "2029-01-01T00:00:00",
    "2029-01-01T01:00:00+01:00",
    "2029-13-01T00:00:00Z",
    "2029-02-30T00:00:00Z",
  ])(
    "refuses %p: only a valid UTC date and time is unambiguous",
    (value) => {
      process.env["PRAXIS_NOW"] = value;
      const parsed = extractRunArgs([]);
      expect(parsed).toEqual({ error: expect.stringContaining("PRAXIS_NOW") });
    }
  );

  test("decides freshness and stamps the run id", async () => {
    const verdicts: Record<string, number> = {};
    for (const now of ["2026-08-20T00:00:00Z", "2029-01-01T00:00:00Z"]) {
      process.env["PRAXIS_NOW"] = now;
      const runsDir = mkdtempSync(join(tmpdir(), "praxis-clock-"));
      const output = join(runsDir, "brief.json");
      const code = await runBriefCli([...ARGS, "--json", "--output", output, "--runs-dir", runsDir], {
        formatsDir: "formats",
        fixturesDir: "tests/fixtures/mock-llm",
      });
      expect(code).toBe(0);
      const brief = JSON.parse(readFileSync(output, "utf-8")) as {
        sourcing_report: { counts: { stale: number } };
      };
      verdicts[now] = brief.sourcing_report.counts.stale;
      const runId = readdirSync(runsDir).find((name) => name !== "brief.json") ?? "";
      expect(runId.startsWith(now.replace(/[-:]/g, ""))).toBe(true);
    }
    // The fixtures' sources were read in August 2026; by 2029 all are past
    // the format's 730-day limit.
    expect(verdicts).toEqual({ "2026-08-20T00:00:00Z": 0, "2029-01-01T00:00:00Z": 29 });
  });
});
