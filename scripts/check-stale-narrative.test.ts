import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanRepository, scanText } from "./check-stale-narrative.ts";

function kinds(text: string): string[] {
  return scanText("f.md", text).map((f) => f.kind);
}

describe("scanText", () => {
  test.each([
    ["Streaming is planned for a future release.", "future"],
    ["Real providers land in v0.3.", "future"],
    ["The cache will be added once profiling shows a need.", "future"],
    ["See ROADMAP.md for the post-v1.3.1 status.", "future"],
    ["`editorial` and `style` are still on the ROADMAP.", "future"],
    ["Implementation coming.", "future"],
    ["Built during sprint 4.", "sprint"],
    ["Wired in S4.2.", "sprint"],
    ["TODO: handle timeouts", "todo-without-issue"],
    ["They are declarative — future releases will interpret them.", "future"],
    ["Sub-typing may land in a later release.", "future"],
    ["A later Sourcing Layer pass will dedupe.", "future"],
    ["When PromptLang ships array types, we will migrate them.", "future"],
    ["The v0.7 Adversarial Critique agent will read the brief.", "future"],
  ])("flags %p as %p", (line, kind) => {
    expect(kinds(line)).toEqual([kind]);
  });

  test.each([
    ["The call will fail with a typed error."],
    ["TODO(#12) handle timeouts"],
    ['"risks_mitigated": ["RISK-XXX", …],'],
    ["If the reader disagrees, no argument that follows will land."],
    ["Released in v1.2.0 (see CHANGELOG)."],
    ["The validator will reject an unknown value."],
  ])("does not flag %p", (line) => {
    expect(kinds(line)).toEqual([]);
  });

  test("reports one finding per line with its 1-based number", () => {
    const findings = scanText("a.md", "ok\nImplementation coming soon\nok");
    expect(findings).toEqual([
      { file: "a.md", line: 2, kind: "future", excerpt: "Implementation coming soon" },
    ]);
  });
});

describe("version-history comments in code", () => {
  // CLAUDE.md rule 6: a comment says why, never when. "Added in v0.8" is
  // history, and git log already holds it.
  test.each([
    ["  // v0.8 additions."],
    [" * Enhanced Markdown renderer (v0.7)."],
    ["/** v0.8 — enables the editorial re-run loop. */"],
    ["const x = 1; // kept from v0.3 for compatibility"],
  ])("flags %p in a .ts file", (line) => {
    expect(scanText("src/a.ts", line).map((f) => f.kind)).toEqual(["version-history"]);
  });

  test.each([
    ['const fixture = "// v0.8 additions.";'],
    ["// see https://example.com/v1.2/docs"],
    ["  // Pinned to the SemVer contract in docs/SEMVER-CONTRACT.md."],
  ])("does not flag %p", (line) => {
    expect(scanText("src/a.ts", line)).toEqual([]);
  });

  test("leaves version numbers in prose files alone", () => {
    expect(scanText("docs/x.md", "Released in v1.2.0, see CHANGELOG.")).toEqual([]);
  });
});

describe("scanRepository", () => {
  test("scans the documented roots and skips the excluded files", async () => {
    const root = mkdtempSync(join(tmpdir(), "praxis-stale-"));
    for (const dir of ["src", "docs", "prompts", "formats", "benchmarks", "tests"]) {
      mkdirSync(join(root, dir));
    }
    const stale = "Planned for v2.0.";
    writeFileSync(join(root, "src", "a.ts"), stale);
    writeFileSync(join(root, "docs", "x.md"), stale);
    writeFileSync(join(root, "prompts", "p.prompt"), stale);
    writeFileSync(join(root, "formats", "f.yaml"), stale);
    writeFileSync(join(root, "benchmarks", "RESULTS.md"), stale);
    writeFileSync(join(root, "README.md"), stale);
    writeFileSync(join(root, "docs", "ENGINEERING_STANDARDS.md"), stale);
    writeFileSync(join(root, "CHANGELOG.md"), stale);
    writeFileSync(join(root, "tests", "t.ts"), stale);
    for (const dir of ["tests", "benchmarks", "scripts"]) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "v.ts"), "// Added in v0.9.\n");
    }

    const files = (await scanRepository(root)).map((f) => f.file);
    expect(files).toEqual([
      "README.md",
      "benchmarks/RESULTS.md",
      "benchmarks/v.ts",
      "docs/x.md",
      "formats/f.yaml",
      "prompts/p.prompt",
      "scripts/v.ts",
      "src/a.ts",
      "tests/v.ts",
    ]);
  });
});
