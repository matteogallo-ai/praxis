/**
 * End-to-end integration test for `praxis brief --with-research`.
 *
 * Spawns the CLI as a real child process (via bun) with the mock
 * provider and verifies the observable contract:
 *
 *   - `brief --with-research` exits 0, prints both agents' outputs,
 *     each finding carries a source URL.
 *   - `brief --with-research --json` prints a parseable JSON with
 *     top-level `scoping` and `research` keys.
 *   - `brief --with-research --provider anthropic` without
 *     ANTHROPIC_API_KEY exits 1 with a clear error.
 *
 * The test exercises the full stack: argv → dispatcher → Orchestrator
 * → Scoping → Research (via MockLLMProvider tool calls) → sourcing
 * validation → JSON stdout.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const CLI = resolve(REPO_ROOT, "src", "cli", "index.ts");

function runCli(argv: readonly string[], extraEnv: Record<string, string> = {}) {
  const env = { ...process.env, NO_COLOR: "1", ...extraEnv };
  // For the "missing key" test, callers pass ANTHROPIC_API_KEY="" to
  // simulate an unset env var. Node's spawn treats empty strings as
  // literal empty values, which the provider correctly detects.
  const res = spawnSync("bun", ["run", CLI, ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env,
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

describe("integration — praxis brief --with-research (v0.3, mock provider)", () => {
  test("nominal run: exits 0 and prints both agent outputs with sources", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--with-research",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Scoping agent output");
    expect(res.stdout).toContain("Research agent output");
    expect(res.stdout).toContain("Findings:");
    expect(res.stdout).toContain("Evidence:");
    expect(res.stdout).toContain("Source:");
    // At least one finding's Source line must be a URL (not SOURCE MISSING).
    expect(res.stdout).toMatch(/Source:\s+https?:\/\//);
  });

  test("--json emits combined { scoping, research } object", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--with-research",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(typeof parsed.scoping.reformulated_question).toBe("string");
    expect(Array.isArray(parsed.research.findings)).toBe(true);
    expect(parsed.research.findings.length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(parsed.research.search_queries_used)).toBe(true);
    // Sourcing policy on executive-pre-read is strict — every source
    // in the combined output must be a URL, none SOURCE_MISSING.
    for (const f of parsed.research.findings) {
      expect(f.source.status).not.toBe("SOURCE_MISSING");
      expect(typeof f.source.url).toBe("string");
    }
  });

  test("--provider anthropic without ANTHROPIC_API_KEY exits 1 with a clear error", () => {
    const res = runCli(
      [
        "brief",
        "Q",
        "--format",
        "executive-pre-read",
        "--with-research",
        "--provider",
        "anthropic",
      ],
      { ANTHROPIC_API_KEY: "" }
    );
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("ANTHROPIC_API_KEY");
    expect(res.stderr).toContain("CONTRIBUTING.md");
  });

  test("--provider unknown exits 1 mentioning both supported providers", () => {
    const res = runCli([
      "brief",
      "Q",
      "--format",
      "executive-pre-read",
      "--provider",
      "openai",
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("openai");
    expect(res.stderr).toContain("mock");
    expect(res.stderr).toContain("anthropic");
  });

  test("--with-research works with mckinsey-style-note", () => {
    const res = runCli([
      "brief",
      "Should we enter Germany?",
      "--format",
      "mckinsey-style-note",
      "--with-research",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.research.findings.length).toBeGreaterThanOrEqual(3);
  });

  test("--with-research works with position-paper-corporate", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "position-paper-corporate",
      "--with-research",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.research.findings.length).toBeGreaterThanOrEqual(3);
  });
});
