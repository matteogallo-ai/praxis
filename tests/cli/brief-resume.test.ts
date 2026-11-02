/**
 * `praxis brief --full` run control: checkpoints, metadata.json with tokens
 * and cost per stage, `--resume <run-id>`, and the run flags' validation.
 *
 * Mock provider: usage is simulated from text length and flagged so.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBriefCli } from "../../src/cli/commands/brief.ts";
import { extractRunArgs } from "../../src/cli/run-args.ts";
import { setColorEnabled } from "../../src/cli/output.ts";

const QUESTION = "Should we enter the German market?";
const FORMAT = "executive-pre-read";

let out: string[];
let err: string[];
let saved: { stdout: typeof process.stdout.write; stderr: typeof process.stderr.write };

beforeEach(() => {
  setColorEnabled(false);
  out = [];
  err = [];
  saved = { stdout: process.stdout.write, stderr: process.stderr.write };
  process.stdout.write = ((chunk: unknown) => out.push(String(chunk)) > 0) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => err.push(String(chunk)) > 0) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = saved.stdout;
  process.stderr.write = saved.stderr;
});

/** The shipped fixtures, with the options answer replaced by `optionsResponse`. */
function fixtures(optionsResponse?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-fixtures-"));
  cpSync("tests/fixtures/mock-llm", dir, { recursive: true });
  if (optionsResponse !== undefined) {
    const path = join(dir, `options-${FORMAT}.json`);
    const fixture = JSON.parse(readFileSync(path, "utf-8")) as { response: string };
    writeFileSync(path, JSON.stringify({ ...fixture, response: optionsResponse }));
  }
  return dir;
}

const onlyRun = (runsDir: string): string => {
  const runs = readdirSync(runsDir);
  expect(runs).toHaveLength(1);
  return runs[0]!;
};

describe("praxis brief --full: checkpoints and metadata.json", () => {
  test("metadata.json carries tokens and cost per stage and for the briefing", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const code = await runBriefCli([QUESTION, "--format", FORMAT, "--full", "--runs-dir", runsDir], {
      formatsDir: "formats",
      fixturesDir: "tests/fixtures/mock-llm",
    });
    expect(code).toBe(0);
    const dir = join(runsDir, onlyRun(runsDir));
    const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"));
    expect(meta.question).toBe(QUESTION);
    expect(meta.usage.simulated).toBe(true);
    expect(Object.keys(meta.usage.stages)).toEqual(["scoping", "research", "stakeholder", "risk", "options", "synthesis"]);
    for (const stage of Object.values(meta.usage.stages) as Array<Record<string, number>>) {
      expect(stage["input_tokens"]).toBeGreaterThan(0);
      expect(stage["output_tokens"]).toBeGreaterThan(0);
      expect(stage["cost_usd"]).toBeGreaterThan(0);
      expect(stage["duration_ms"]).toBeGreaterThanOrEqual(0);
    }
    expect(meta.usage.total.cost_usd).toBeGreaterThan(0);
  });
});

describe("praxis brief --resume (failure simulated at stage 5, options)", () => {
  test("the resumed run makes no call for stages 1–4 and completes", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const broken = { formatsDir: "formats", fixturesDir: fixtures("this is not JSON") };
    expect(await runBriefCli([QUESTION, "--format", FORMAT, "--full", "--runs-dir", runsDir], broken)).toBe(1);

    const runId = onlyRun(runsDir);
    const dir = join(runsDir, runId);
    expect(err.join("")).toContain(`--resume ${runId}`);
    for (const stage of ["scoping", "research", "stakeholder", "risk"]) {
      expect(existsSync(join(dir, `${stage}.json`))).toBe(true);
    }
    expect(existsSync(join(dir, "options.json"))).toBe(false);
    const failed = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"));
    // Malformed output is recoverable: the options stage was tried twice.
    expect(failed.usage.stages.options.calls).toBe(2);

    out = [];
    const fixed = { formatsDir: "formats", fixturesDir: fixtures() };
    expect(await runBriefCli(["--resume", runId, "--runs-dir", runsDir], fixed)).toBe(0);
    const resumed = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf-8"));
    // The report covers the whole briefing: the first attempt's stages and
    // its two failed options calls, then the resumed options call and synthesis.
    expect(Object.keys(resumed.usage.stages)).toEqual(["scoping", "research", "stakeholder", "risk", "options", "synthesis"]);
    expect(resumed.usage.stages.scoping.calls).toBe(failed.usage.stages.scoping.calls);
    expect(resumed.usage.stages.options.calls).toBe(3);
    expect(resumed.usage.total.cost_usd).toBeGreaterThan(failed.usage.total.cost_usd);
    expect(out.join("")).toContain("#");
  });

  test("a different question or format than the run's is refused", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const ctx = { formatsDir: "formats", fixturesDir: "tests/fixtures/mock-llm" };
    await runBriefCli([QUESTION, "--format", FORMAT, "--full", "--runs-dir", runsDir], ctx);
    const runId = onlyRun(runsDir);
    expect(await runBriefCli(["Another question?", "--resume", runId, "--runs-dir", runsDir], ctx)).toBe(1);
    expect(await runBriefCli(["--resume", runId, "--format", "family-office-memo", "--runs-dir", runsDir], ctx)).toBe(1);
    expect(await runBriefCli(["--resume", "missing-run", "--runs-dir", runsDir], ctx)).toBe(1);
    // Outputs made under one sourcing mode (or provider, prompts, format) are not reused under another.
    expect(
      await runBriefCli(["--resume", runId, "--runs-dir", runsDir, "--on-sourcing-failure", "abort"], ctx)
    ).toBe(1);
    expect(err.join("")).toContain("on_sourcing_failure was 'degrade', now 'abort'");
    expect(err.join("")).toContain("No run 'missing-run'");
  });
});

describe("praxis brief --max-cost-usd", () => {
  test("a cap smaller than the first call stops the run before stage 2", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "praxis-runs-"));
    const code = await runBriefCli(
      [QUESTION, "--format", FORMAT, "--full", "--runs-dir", runsDir, "--max-cost-usd", "0.000001"],
      { formatsDir: "formats", fixturesDir: "tests/fixtures/mock-llm" }
    );
    expect(code).toBe(1);
    expect(err.join("")).toContain("Budget cap reached before stage 'research'");
    const meta = JSON.parse(readFileSync(join(runsDir, onlyRun(runsDir), "metadata.json"), "utf-8"));
    expect(meta.usage.total.calls).toBe(1);
    expect(meta.usage.max_cost_usd).toBe(0.000001);
  });

  test("the run flags are validated", () => {
    expect(extractRunArgs(["--max-cost-usd", "-1"])).toEqual({
      error: "--max-cost-usd expects a positive number of US dollars",
    });
    expect(extractRunArgs(["--resume"])).toEqual({ error: "--resume expects a value" });
    expect(extractRunArgs(["Q", "--price-table=p.json"])).toMatchObject({ rest: ["Q"], run: { priceTable: "p.json" } });
  });
});
