/**
 * What stands between `run-all.ts` and a paid run: a live run needs an
 * explicit per-briefing cost cap, an API key on disk alone never selects
 * live mode, and `--ids` runs exactly the questions named.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { liveLedger, parseRunAllArgs, runAll } from "../../benchmarks/run-all.ts";

let savedKey: string | undefined;
let write: typeof process.stderr.write;

beforeEach(() => {
  savedKey = process.env["ANTHROPIC_API_KEY"];
  write = process.stderr.write;
  process.stderr.write = () => true;
});

afterEach(() => {
  if (savedKey === undefined) delete process.env["ANTHROPIC_API_KEY"];
  else process.env["ANTHROPIC_API_KEY"] = savedKey;
  process.stderr.write = write;
});

const dry = { mockOnly: false, liveOnly: false, dryRun: true, root: "." };

describe("run-all — cost cap", () => {
  test("--live-only without --max-cost-usd is refused, except as a dry run", () => {
    expect(() => parseRunAllArgs(["--live-only"])).toThrow(/--max-cost-usd/);
    expect(parseRunAllArgs(["--live-only", "--dry-run"]).liveOnly).toBe(true);
    expect(parseRunAllArgs(["--live-only", "--max-cost-usd", "8"]).maxCostUsd).toBe(8);
    expect(parseRunAllArgs(["--live-only", "--max-cost-usd=2.5"]).maxCostUsd).toBe(2.5);
  });

  test("--max-cost-usd must be a positive number", () => {
    for (const v of ["0", "-1", "x", "Infinity"]) {
      expect(() => parseRunAllArgs(["--max-cost-usd", v])).toThrow(/positive number/);
    }
    expect(() => parseRunAllArgs(["--max-cost-usd"])).toThrow(/positive number/);
  });

  test("a key on disk without a cap runs mock only", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-not-a-real-key";
    const summary = await runAll({ ...dry, ids: ["02-cfo-buyback-briefing"] });
    expect(summary.outcomes.map((o) => o.mode)).toEqual(["mock"]);
  });

  test("a key and a cap run mock and live", async () => {
    process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-not-a-real-key";
    const summary = await runAll({ ...dry, ids: ["02-cfo-buyback-briefing"], maxCostUsd: 8 });
    expect(summary.outcomes.map((o) => o.mode)).toEqual(["mock", "live"]);
  });

  test("the live ledger carries the cap", () => {
    expect(liveLedger(8).summary().max_cost_usd).toBe(8);
    expect(liveLedger(8).summary().simulated).toBe(false);
  });
});

describe("run-all — --ids", () => {
  test("parses a comma-separated list", () => {
    expect(parseRunAllArgs(["--ids", "a,b"]).ids).toEqual(["a", "b"]);
    expect(parseRunAllArgs(["--ids=a"]).ids).toEqual(["a"]);
    expect(() => parseRunAllArgs(["--ids"])).toThrow(/--ids/);
    expect(() => parseRunAllArgs(["--ids", "a,,b"])).toThrow(/--ids/);
  });

  test("runs exactly the questions named, in manifest order", async () => {
    const ids = ["12-sodium-ion-plant-morocco", "02-cfo-buyback-briefing"];
    const summary = await runAll({ ...dry, mockOnly: true, ids });
    expect(summary.outcomes.map((o) => o.id)).toEqual(["02-cfo-buyback-briefing", "12-sodium-ion-plant-morocco"]);
  });

  test("an unknown id is refused", async () => {
    await expect(runAll({ ...dry, mockOnly: true, ids: ["99-nope"] })).rejects.toThrow(/99-nope/);
  });

  test("with --split, an id from the other half is refused", async () => {
    await expect(
      runAll({ ...dry, mockOnly: true, split: "test", ids: ["01-german-market-entry"] })
    ).rejects.toThrow(/01-german-market-entry/);
  });
});
