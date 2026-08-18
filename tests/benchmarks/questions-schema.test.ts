/**
 * v0.9 — Validate `benchmarks/questions.yaml` at test time.
 *
 * This test pins the manifest schema so a bad edit surfaces in
 * CI, not at bench-time. Contract:
 *
 *   - version:        integer, currently 1.
 *   - benchmarks[]:   exactly 10 entries (closed set for v0.9).
 *   - each benchmark: id (kebab, numbered NN-title-slug),
 *                     question (non-empty),
 *                     format (one of the three shipped ids),
 *                     tags   (non-empty list of strings),
 *                     intent (non-empty).
 *   - ids are unique.
 *   - `--format auto` on the question resolves to the manifest's
 *      declared format (auto-router coherence).
 */
import { describe, expect, test } from "bun:test";

import { loadManifest } from "../../benchmarks/run-all.ts";
import {
  AUTO_FORMAT_IDS,
  detectFormatFromQuestion,
} from "../../src/cli/format-auto.ts";

const MANIFEST = loadManifest("benchmarks/questions.yaml");

describe("benchmarks/questions.yaml — schema", () => {
  test("version is 1", () => {
    expect(MANIFEST.version).toBe(1);
  });

  test("exactly 10 entries (v0.9 closed set)", () => {
    expect(MANIFEST.benchmarks.length).toBe(10);
  });

  test("every id is kebab-case with a leading NN- prefix", () => {
    for (const b of MANIFEST.benchmarks) {
      expect(b.id).toMatch(/^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  test("every id is unique", () => {
    const ids = new Set<string>();
    for (const b of MANIFEST.benchmarks) {
      expect(ids.has(b.id)).toBe(false);
      ids.add(b.id);
    }
    expect(ids.size).toBe(10);
  });

  test("every format field is one of the three shipped ids", () => {
    for (const b of MANIFEST.benchmarks) {
      expect((AUTO_FORMAT_IDS as readonly string[]).includes(b.format)).toBe(true);
    }
  });

  test("every entry has a non-empty question and intent", () => {
    for (const b of MANIFEST.benchmarks) {
      expect(b.question.length).toBeGreaterThan(10);
      expect(b.intent.length).toBeGreaterThan(20);
    }
  });

  test("every entry has at least one tag", () => {
    for (const b of MANIFEST.benchmarks) {
      expect(b.tags.length).toBeGreaterThan(0);
      for (const t of b.tags) {
        expect(t.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("benchmarks/questions.yaml — --format auto coherence", () => {
  test("every question routes to its declared format via --format auto", () => {
    for (const b of MANIFEST.benchmarks) {
      const detected = detectFormatFromQuestion(b.question);
      // Either a direct match to the declared format, OR ambiguous with
      // the declared format among the matches. Both are acceptable for
      // the coherence check — an ambiguous match means the question is
      // near a border; a no-match means we probably worded the question
      // poorly.
      if (detected.kind === "matched") {
        expect(detected.id as string).toBe(b.format);
      } else if (detected.kind === "ambiguous") {
        const ids: string[] = detected.matches.map((m) => m.id as string);
        expect(ids).toContain(b.format);
      } else {
        // no-match should never occur for a hand-authored benchmark.
        throw new Error(
          `benchmark ${b.id}: question does not match any format via --format auto`
        );
      }
    }
  });
});

describe("benchmarks/questions.yaml — format coverage", () => {
  test("all three shipped formats have at least one benchmark", () => {
    const seen = new Set<string>(MANIFEST.benchmarks.map((b) => b.format));
    for (const id of AUTO_FORMAT_IDS) {
      expect(seen.has(id)).toBe(true);
    }
  });
});
