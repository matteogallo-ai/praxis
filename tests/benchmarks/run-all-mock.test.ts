/**
 * v0.9 — Runner unit tests for `benchmarks/run-all.ts`.
 *
 * These tests cover the pure surface of the runner:
 *   - `parseRunAllArgs` interprets --mock-only, --live-only,
 *     --dry-run, --root, and rejects mutually exclusive combos.
 *   - `loadManifest` throws on structurally bad manifests.
 *   - `runAll` in --dry-run mode returns an outcome per benchmark
 *     without spawning the pipeline.
 *
 * The actual 10-benchmark generation is exercised by
 * `bun run bench:mock` at release time (not in the unit-test
 * suite — a full mock run touches every renderer and takes
 * seconds).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadManifest,
  parseRunAllArgs,
  runAll,
} from "../../benchmarks/run-all.ts";

let originalStderr: typeof process.stderr.write;

beforeEach(() => {
  originalStderr = process.stderr.write.bind(process.stderr);
  // Silence run-all's stderr chatter — the runner logs a "→ benchmarks:"
  // line on entry which is not part of the unit-test surface.
  process.stderr.write = ((_chunk: unknown): boolean => true) as typeof process.stderr.write;
});

afterEach(() => {
  process.stderr.write = originalStderr;
});

// ---------------------------------------------------------------------------
// parseRunAllArgs
// ---------------------------------------------------------------------------

describe("parseRunAllArgs", () => {
  test("defaults to no flags", () => {
    const o = parseRunAllArgs([]);
    expect(o.mockOnly).toBe(false);
    expect(o.liveOnly).toBe(false);
    expect(o.dryRun).toBe(false);
  });

  test("--mock-only sets mockOnly", () => {
    expect(parseRunAllArgs(["--mock-only"]).mockOnly).toBe(true);
  });

  test("--live-only sets liveOnly", () => {
    expect(parseRunAllArgs(["--live-only"]).liveOnly).toBe(true);
  });

  test("--dry-run sets dryRun", () => {
    expect(parseRunAllArgs(["--dry-run"]).dryRun).toBe(true);
  });

  test("--mock-only and --live-only together throw", () => {
    expect(() =>
      parseRunAllArgs(["--mock-only", "--live-only"])
    ).toThrow(/mutually exclusive/i);
  });

  test("--root <path> is honoured", () => {
    const o = parseRunAllArgs(["--root", "/tmp/x"]);
    expect(o.root).toBe("/tmp/x");
  });

  test("--root=<path> equals form", () => {
    const o = parseRunAllArgs(["--root=/tmp/y"]);
    expect(o.root).toBe("/tmp/y");
  });

  test("unknown flag throws", () => {
    expect(() => parseRunAllArgs(["--nope"])).toThrow(/Unknown flag/);
  });
});

// ---------------------------------------------------------------------------
// loadManifest
// ---------------------------------------------------------------------------

describe("loadManifest — structural failures", () => {
  test("throws on missing version", () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-bench-"));
    const path = join(dir, "bad.yaml");
    // Block-style empty list so the (restricted) yaml parser accepts
    // it. The missing `version` field is what we want to trigger.
    writeFileSync(path, "benchmarks:\n", "utf-8");
    try {
      expect(() => loadManifest(path)).toThrow(/version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws on missing benchmarks list", () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-bench-"));
    const path = join(dir, "bad.yaml");
    writeFileSync(path, "version: 1\n", "utf-8");
    try {
      expect(() => loadManifest(path)).toThrow(/benchmarks/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("throws on entry missing 'question'", () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-bench-"));
    const path = join(dir, "bad.yaml");
    writeFileSync(
      path,
      [
        "version: 1",
        "benchmarks:",
        "  - id: 'x'",
        "    format: 'executive-pre-read'",
        "    tags:",
        "      - t",
        "    intent: 'x'",
        "",
      ].join("\n"),
      "utf-8"
    );
    try {
      expect(() => loadManifest(path)).toThrow(/question/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loadManifest — happy path", () => {
  test("loads the shipped benchmarks/questions.yaml", () => {
    const m = loadManifest("benchmarks/questions.yaml");
    expect(m.version).toBe(1);
    expect(m.benchmarks.length).toBe(10);
    for (const b of m.benchmarks) {
      expect(b.id.length).toBeGreaterThan(0);
      expect(b.question.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// runAll — --dry-run mode returns one outcome per benchmark per mode
// ---------------------------------------------------------------------------

describe("runAll — --dry-run", () => {
  test("mock-only + dry-run returns 10 ok outcomes without spawning the pipeline", async () => {
    const summary = await runAll({
      mockOnly: true,
      liveOnly: false,
      dryRun: true,
      root: ".",
    });
    expect(summary.total).toBe(10);
    expect(summary.ok).toBe(10);
    expect(summary.failed).toBe(0);
    expect(summary.outcomes.every((o) => o.mode === "mock")).toBe(true);
    expect(summary.outcomes.every((o) => o.ok)).toBe(true);
  });

  test("live-only + dry-run does NOT check for the API key (dry-run bypass)", async () => {
    // Dry-run must NOT dispatch the LLM factory — the summary is
    // constructed purely from the manifest.
    const summary = await runAll({
      mockOnly: false,
      liveOnly: true,
      dryRun: true,
      root: ".",
    });
    expect(summary.total).toBe(10);
    expect(summary.outcomes.every((o) => o.mode === "live")).toBe(true);
  });
});
