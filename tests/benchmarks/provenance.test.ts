/**
 * The record a live benchmark run leaves (`benchmarks/provenance.ts`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  commitLiveRun,
  completedLiveRuns,
  provenance,
  recordLiveFailure,
  stageLiveRun,
} from "../../benchmarks/provenance.ts";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "praxis-provenance-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("provenance", () => {
  const p = provenance(".");

  test("names the commit", () => {
    expect(p.git_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof p.git_dirty).toBe("boolean");
  });

  test("records every prompt's @version and @model as the file declares them", () => {
    const files = readdirSync("prompts").filter((f) => f.endsWith(".prompt"));
    expect(Object.keys(p.prompts).sort()).toEqual(files.sort());
    for (const f of files) {
      const text = readFileSync(join("prompts", f), "utf-8");
      expect(p.prompts[f]?.version).toBe(text.match(/^@version "([^"]+)"/m)?.[1] ?? null);
      expect(p.prompts[f]?.model).toBe(text.match(/^@model (\S+)/m)?.[1] ?? null);
      expect(p.prompts[f]?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("completed live runs", () => {
  const at = new Date("2026-11-04T08:33:09.131Z");

  test("each completed run gets its own directory named by its start time", () => {
    const dir = tempDir();
    const staged = stageLiveRun(dir, at);
    writeFileSync(join(staged, "metadata.json"), "{}");
    const run = commitLiveRun(staged, dir, at);
    expect(run).toBe(join(dir, "run-2026-11-04T08-33-09-131Z"));
    expect(existsSync(staged)).toBe(false);
    expect(completedLiveRuns(dir)).toEqual([run]);
  });

  test("a second completed run is kept beside the first, never over it", () => {
    const dir = tempDir();
    const later = new Date("2026-11-05T10:00:00.000Z");
    for (const t of [at, later]) {
      const staged = stageLiveRun(dir, t);
      writeFileSync(join(staged, "metadata.json"), JSON.stringify({ t: t.toISOString() }));
      commitLiveRun(staged, dir, t);
    }
    const runs = completedLiveRuns(dir);
    expect(runs).toHaveLength(2);
    expect(readFileSync(join(runs[0] as string, "metadata.json"), "utf-8")).toContain("2026-11-04");
    expect(readFileSync(join(runs[1] as string, "metadata.json"), "utf-8")).toContain("2026-11-05");
  });

  test("refuses to commit over an existing run directory", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "run-2026-11-04T08-33-09-131Z"));
    writeFileSync(join(dir, "run-2026-11-04T08-33-09-131Z", "metadata.json"), "{}");
    const staged = stageLiveRun(dir, at);
    expect(() => commitLiveRun(staged, dir, at)).toThrow(/never overwritten/);
    expect(readFileSync(join(dir, "run-2026-11-04T08-33-09-131Z", "metadata.json"), "utf-8")).toBe("{}");
  });

  test("ignores failures, staged runs and run directories without metadata", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "error-x.json"), "{}");
    stageLiveRun(dir, at);
    mkdirSync(join(dir, "run-2026-11-01T00-00-00-000Z"));
    expect(completedLiveRuns(dir)).toEqual([]);
    expect(completedLiveRuns(join(dir, "absent"))).toEqual([]);
  });
});

describe("recordLiveFailure", () => {
  test("keeps each failure in its own file, with its time and cause", () => {
    const dir = tempDir();
    recordLiveFailure(dir, new Date("2026-11-03T10:00:00.000Z"), { error: "timeout" });
    recordLiveFailure(dir, new Date("2026-11-03T11:00:00.000Z"), { error: "budget" });
    const files = readdirSync(dir).sort();
    expect(files).toEqual(["error-2026-11-03T10-00-00-000Z.json", "error-2026-11-03T11-00-00-000Z.json"]);
    const first = JSON.parse(readFileSync(join(dir, files[0] as string), "utf-8"));
    expect(first).toEqual({ failed_at: "2026-11-03T10:00:00.000Z", error: "timeout" });
  });

  test("redacts a key the error echoes", () => {
    const dir = tempDir();
    const path = recordLiveFailure(dir, new Date(0), {
      error: "401 from API: x-api-key: sk-ant-api03-abcdefghijklmnop",
    });
    const text = readFileSync(path, "utf-8");
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).toContain("[redacted]");
  });
});
