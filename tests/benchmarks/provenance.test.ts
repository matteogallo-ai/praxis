/**
 * The record a live benchmark run leaves (`benchmarks/provenance.ts`).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertNoLiveRecord, provenance, recordLiveFailure } from "../../benchmarks/provenance.ts";

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

describe("assertNoLiveRecord", () => {
  test("refuses a directory that holds a completed run, accepts one with only failures", () => {
    const dir = tempDir();
    expect(() => assertNoLiveRecord(dir)).not.toThrow();
    writeFileSync(join(dir, "error-x.json"), "{}");
    expect(() => assertNoLiveRecord(dir)).not.toThrow();
    writeFileSync(join(dir, "metadata.json"), "{}");
    expect(() => assertNoLiveRecord(dir)).toThrow(/never overwritten/);
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
