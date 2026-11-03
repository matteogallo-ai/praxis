/**
 * The frozen dev/test split of the evaluation set (`benchmarks/split.ts`).
 */
import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseYaml } from "@promptlang/yaml-parser";

import { loadManifest } from "../../benchmarks/manifest.ts";
import { parseRunAllArgs, runAll } from "../../benchmarks/run-all.ts";
import {
  DEV_FRACTION,
  MANIFEST_PATH,
  loadSplit,
  SPLIT_PATH,
  main,
  render,
  split,
  stratum,
} from "../../benchmarks/split.ts";

const manifest = loadManifest(MANIFEST_PATH);
const committed = parseYaml(readFileSync(SPLIT_PATH, "utf-8")) as {
  manifest_version: number;
  dev: string[];
  test: string[];
};

describe("benchmarks/split.yaml", () => {
  test("is the seeded draw of the current questions.yaml", () => {
    expect(main(["--check"])).toBe(0);
  });

  test("records the manifest version it was drawn from", () => {
    expect(committed.manifest_version).toBe(manifest.version);
  });

  test("dev and test partition the manifest", () => {
    const ids = manifest.benchmarks.map((b) => b.id);
    expect(committed.dev.filter((id) => committed.test.includes(id))).toEqual([]);
    expect([...committed.dev, ...committed.test].sort()).toEqual([...ids].sort());
  });

  test("every stratum is measured on test, and each of two or more questions is also on dev", () => {
    const strataOf = new Map(manifest.benchmarks.map((b) => [b.id, stratum(b)]));
    const strata = new Set(manifest.benchmarks.map(stratum));
    for (const s of strata) {
      const size = manifest.benchmarks.filter((b) => stratum(b) === s).length;
      const onDev = committed.dev.filter((id) => strataOf.get(id) === s).length;
      const onTest = committed.test.filter((id) => strataOf.get(id) === s).length;
      expect(onDev).toBe(Math.round(size * DEV_FRACTION));
      expect(onTest).toBeGreaterThan(0);
      if (size >= 2) expect(onDev).toBeGreaterThan(0);
    }
  });

  test("the hard case is a stratum of its own and lands on test", () => {
    const hard = manifest.benchmarks.filter((b) => b.tags.includes("hard"));
    expect(hard.map(stratum)).toEqual(["hard"]);
    expect(committed.test).toEqual(expect.arrayContaining(hard.map((b) => b.id)));
  });
});

describe("split", () => {
  test("does not depend on the order of the manifest", () => {
    const reversed = [...manifest.benchmarks].reverse();
    const a = split(manifest.benchmarks);
    const b = split(reversed);
    expect([...b.dev].sort()).toEqual([...a.dev].sort());
    expect([...b.test].sort()).toEqual([...a.test].sort());
  });

  test("an edit to questions.yaml changes the rendered file, so --check fails until the split is redrawn", () => {
    const text = readFileSync(MANIFEST_PATH, "utf-8");
    const s = split(manifest.benchmarks);
    expect(render(text, manifest.version, s)).toBe(readFileSync(SPLIT_PATH, "utf-8"));
    expect(render(text.replace("Morocco", "Tunisia"), manifest.version, s)).not.toBe(
      readFileSync(SPLIT_PATH, "utf-8")
    );
  });

  test("main refuses an unknown argument", () => {
    expect(main(["--force"])).toBe(2);
  });
});

describe("run-all --split", () => {
  test("parses dev and test, and refuses anything else", () => {
    expect(parseRunAllArgs(["--split", "test"]).split).toBe("test");
    expect(parseRunAllArgs(["--split=dev"]).split).toBe("dev");
    expect(parseRunAllArgs([]).split).toBeUndefined();
    expect(() => parseRunAllArgs(["--split", "all"])).toThrow(/dev or test/);
    expect(() => parseRunAllArgs(["--split"])).toThrow(/dev or test/);
  });

  test("runs exactly the questions of that half", async () => {
    const write = process.stderr.write;
    process.stderr.write = () => true;
    try {
      for (const half of ["dev", "test"] as const) {
        const summary = await runAll({
          mockOnly: true,
          liveOnly: false,
          dryRun: true,
          root: ".",
          split: half,
        });
        expect(summary.outcomes.map((o) => o.id)).toEqual(committed[half]);
      }
    } finally {
      process.stderr.write = write;
    }
  });

  test("a split that no longer matches questions.yaml is refused", () => {
    const root = mkdtempSync(join(tmpdir(), "praxis-split-"));
    try {
      cpSync(SPLIT_PATH, join(root, "benchmarks", "split.yaml"), { recursive: true });
      writeFileSync(
        join(root, "benchmarks", "questions.yaml"),
        readFileSync(MANIFEST_PATH, "utf-8").replace("Morocco", "Tunisia")
      );
      expect(() => loadSplit(root)).toThrow(/stale split/);
      expect(loadSplit(".")).toEqual({ dev: committed.dev, test: committed.test });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
