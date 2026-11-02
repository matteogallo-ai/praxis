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
  ])("flags %p as %p", (line, kind) => {
    expect(kinds(line)).toEqual([kind]);
  });

  test.each([
    ["The call will fail with a typed error."],
    ["TODO(#12) handle timeouts"],
    ['"risks_mitigated": ["RISK-XXX", …],'],
    ["If the reader disagrees, no argument that follows will land."],
    ["Released in v1.2.0 (see CHANGELOG)."],
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

describe("scanRepository", () => {
  test("scans the documented roots and skips the excluded files", async () => {
    const root = mkdtempSync(join(tmpdir(), "praxis-stale-"));
    for (const dir of ["src", "docs", "prompts", "formats", "benchmarks", "tests"]) {
      mkdirSync(join(root, dir));
    }
    const stale = "Planned for v2.0.";
    writeFileSync(join(root, "src", "a.ts"), stale);
    writeFileSync(join(root, "prompts", "p.prompt"), stale);
    writeFileSync(join(root, "formats", "f.yaml"), stale);
    writeFileSync(join(root, "benchmarks", "RESULTS.md"), stale);
    writeFileSync(join(root, "README.md"), stale);
    writeFileSync(join(root, "docs", "ENGINEERING_STANDARDS.md"), stale);
    writeFileSync(join(root, "CHANGELOG.md"), stale);
    writeFileSync(join(root, "tests", "t.ts"), stale);

    const files = (await scanRepository(root)).map((f) => f.file);
    expect(files).toEqual([
      "README.md",
      "benchmarks/RESULTS.md",
      "formats/f.yaml",
      "prompts/p.prompt",
      "src/a.ts",
    ]);
  });
});
