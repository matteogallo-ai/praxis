/**
 * The live guards of `run-all.ts`, run against a throwaway git repository
 * and a fake `fetch`: no request leaves the machine. Each test counts the
 * requests the provider attempted, so a guard that lets a paid call through
 * fails here.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAll } from "../../benchmarks/run-all.ts";

const ID = "02-cfo-buyback-briefing";
let root: string;
let calls: number;
let saved: { key: string | undefined; fetch: typeof fetch; write: typeof process.stderr.write };

function git(...args: string[]): void {
  const out = Bun.spawnSync(["git", "-C", root, ...args]);
  if (out.exitCode !== 0) throw new Error(out.stderr.toString());
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "praxis-live-guard-"));
  for (const dir of ["formats", "prompts"]) cpSync(dir, join(root, dir), { recursive: true });
  mkdirSync(join(root, "benchmarks"));
  for (const f of ["questions.yaml", "split.yaml"]) cpSync(join("benchmarks", f), join(root, "benchmarks", f));
  git("init", "-q");
  git("-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture");

  saved = { key: process.env["ANTHROPIC_API_KEY"], fetch: globalThis.fetch, write: process.stderr.write };
  process.env["ANTHROPIC_API_KEY"] = "sk-ant-test-not-a-real-key";
  process.stderr.write = () => true;
  calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = saved.fetch;
  process.stderr.write = saved.write;
  if (saved.key === undefined) delete process.env["ANTHROPIC_API_KEY"];
  else process.env["ANTHROPIC_API_KEY"] = saved.key;
  rmSync(root, { recursive: true, force: true });
});

const live = () => ({ mockOnly: false, liveOnly: true, dryRun: false, root, ids: [ID] });
const liveDir = () => join(root, "benchmarks", "outputs", "live", ID);

describe("run-all live guards", () => {
  test("runAll refuses a live run without a cap, before any request", async () => {
    await expect(runAll(live())).rejects.toThrow(/--max-cost-usd/);
    expect(calls).toBe(0);
  });

  test("a modified tracked file stops the run before any request", async () => {
    writeFileSync(join(root, "benchmarks", "questions.yaml"), "# edited\n", { flag: "a" });
    await expect(runAll({ ...live(), maxCostUsd: 5 })).rejects.toThrow(/clean working tree/);
    expect(calls).toBe(0);
  });

  test("an untracked prompt stops the run before any request", async () => {
    writeFileSync(join(root, "prompts", "extra.prompt"), readFileSync(join(root, "prompts", "scoping.prompt")));
    await expect(runAll({ ...live(), maxCostUsd: 5 })).rejects.toThrow(/clean working tree/);
    expect(calls).toBe(0);
  });

  test("a question with a completed run can run again; the first run is left as it was", async () => {
    const first = join(liveDir(), "run-2026-11-04T08-33-09-131Z");
    mkdirSync(first, { recursive: true });
    writeFileSync(join(first, "metadata.json"), "{}\n");
    const summary = await runAll({ ...live(), maxCostUsd: 5 });
    expect(calls).toBeGreaterThan(0);
    expect(summary.outcomes[0]?.ok).toBe(false);
    expect(readFileSync(join(first, "metadata.json"), "utf-8")).toBe("{}\n");
    expect(readdirSync(liveDir()).filter((f) => f.startsWith("run-"))).toEqual(["run-2026-11-04T08-33-09-131Z"]);
  });

  test("a failed briefing leaves an error record carrying the cap, and no key", async () => {
    const summary = await runAll({ ...live(), maxCostUsd: 5 });
    expect(summary.outcomes[0]?.ok).toBe(false);
    expect(calls).toBeGreaterThan(0);
    const errors = readdirSync(liveDir()).filter((f) => f.startsWith("error-"));
    expect(errors).toHaveLength(1);
    const text = readFileSync(join(liveDir(), errors[0] as string), "utf-8");
    const record = JSON.parse(text) as { usage: { max_cost_usd: number }; provenance: { git_dirty: boolean } };
    expect(record.usage.max_cost_usd).toBe(5);
    expect(record.provenance.git_dirty).toBe(false);
    expect(text).not.toContain("sk-ant-test-not-a-real-key");
    expect(existsSync(join(liveDir(), "metadata.json"))).toBe(false);
    // A failed briefing leaves no partial run behind.
    expect(readdirSync(liveDir()).filter((f) => f.startsWith("run-"))).toEqual([]);
  });
});

describe("run-all live guards — cap values", () => {
  test("a NaN, infinite or non-positive cap is refused before any request", async () => {
    for (const maxCostUsd of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      await expect(runAll({ ...live(), maxCostUsd })).rejects.toThrow(/--max-cost-usd/);
    }
    expect(calls).toBe(0);
  });
});
