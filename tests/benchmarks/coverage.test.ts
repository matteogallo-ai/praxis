/**
 * Regression test for benchmark artefact coverage.
 *
 * Guarantees that every committed mock benchmark output directory
 * carries the full trifecta the scoring framework relies on:
 *
 *   brief.md      — input to benchmarks/score-all.ts
 *   brief.pdf     — human-review artefact
 *   brief.docx    — human-review artefact
 *   metadata.json — run metadata (question, format, timing, ...)
 *
 * The formats declare different `output_targets` subsets; the
 * benchmark harness emits all three files regardless, so every
 * briefing can be compared in every format. Gating on
 * `output_targets` once left some mock briefings without
 * `brief.md` or `brief.docx`.
 *
 * This test guards against the regression on the committed
 * outputs. A silent revert of the run-all.ts change would drop
 * files from disk on the next `bun run bench:mock` and be caught
 * here as soon as the outputs are re-committed.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const MOCK_OUTPUTS = join(REPO_ROOT, "benchmarks", "outputs", "mock");

const REQUIRED_FILES = [
  "brief.md",
  "brief.pdf",
  "brief.docx",
  "metadata.json",
] as const;

describe("benchmark artefact coverage — mock outputs", () => {
  test("mock outputs directory exists", () => {
    expect(existsSync(MOCK_OUTPUTS)).toBe(true);
  });

  const benchmarkDirs = existsSync(MOCK_OUTPUTS)
    ? readdirSync(MOCK_OUTPUTS)
        .map((name) => ({ name, path: join(MOCK_OUTPUTS, name) }))
        .filter((entry) => statSync(entry.path).isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  test("at least 10 mock benchmark directories are present", () => {
    expect(benchmarkDirs.length).toBeGreaterThanOrEqual(10);
  });

  for (const { name, path } of benchmarkDirs) {
    for (const file of REQUIRED_FILES) {
      test(`${name} carries ${file}`, () => {
        const filePath = join(path, file);
        expect(existsSync(filePath)).toBe(true);
        expect(statSync(filePath).size).toBeGreaterThan(0);
      });
    }
  }
});
