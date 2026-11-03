/**
 * The repository resolves PromptLang from npm and nothing else (DoD D5,
 * CLAIMS C19). The CI job `clean-clone` proves it by running install, the
 * suite and a mock brief in a clone with nothing next to it; these checks
 * keep a sibling path from coming back between runs of that job.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as { dependencies: Record<string, string> };
const tsconfig = JSON.parse(readFileSync("tsconfig.json", "utf-8")) as { compilerOptions: Record<string, unknown> };
const ci = readFileSync(".github/workflows/ci.yml", "utf-8");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("PromptLang from npm", () => {
  test("@promptlang/core is a dependency pinned to one exact version", () => {
    expect(pkg.dependencies["@promptlang/core"]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("tsconfig maps no path and sets no baseUrl", () => {
    expect(tsconfig.compilerOptions["paths"]).toBeUndefined();
    expect(tsconfig.compilerOptions["baseUrl"]).toBeUndefined();
  });

  test("no source imports PromptLang by a bare or relative path", () => {
    const offenders = ["src", "benchmarks", "scripts", "tests"]
      .flatMap(sources)
      .filter((f) => /from\s+["'](?:promptlang(?:\/|["'])|(?:\.\.\/)+promptlang)/.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });

  test("CI checks out no PromptLang repository and runs the clean-clone job", () => {
    expect(ci).not.toMatch(/repository:\s*matteogallo-ai\/promptlang/);
    expect(ci).not.toContain("../promptlang");
    const job = ci.slice(ci.indexOf("  clean-clone:"), ci.indexOf("\n  lint:"));
    expect(job).toContain("bun install --frozen-lockfile");
    expect(job).toContain("bun test");
    expect(job).toContain('bun run cli brief "Should we enter the German market?" --format auto --full');
  });
});
