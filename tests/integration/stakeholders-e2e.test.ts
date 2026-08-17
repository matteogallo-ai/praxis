/**
 * End-to-end integration test for `praxis brief --with-stakeholders`.
 *
 * Spawns the CLI as a real child process (via bun) with the mock
 * provider and verifies the observable contract:
 *
 *   - `brief --with-research --with-stakeholders` exits 0 and prints
 *     the three agent sections plus the compact stakeholder table.
 *   - `brief --with-stakeholders` alone works (implies --with-research)
 *     and prints an implication note to stdout.
 *   - `brief --with-stakeholders --json` prints a parseable
 *     `{ scoping, research, stakeholders }` object.
 *   - `brief --with-stakeholders --provider anthropic` without
 *     ANTHROPIC_API_KEY exits 1 with a clear error.
 *
 * Exercises the full stack: argv → dispatcher → Orchestrator →
 * Scoping → Research (tool-use) → Stakeholder Mapping (tool-use) →
 * sourcing validation → stdout.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const CLI = resolve(REPO_ROOT, "src", "cli", "index.ts");

function runCli(argv: readonly string[], extraEnv: Record<string, string> = {}) {
  const env = { ...process.env, NO_COLOR: "1", ...extraEnv };
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

describe("integration — praxis brief --with-stakeholders (v0.4, mock provider)", () => {
  test("nominal run: exits 0 and prints all three agent outputs plus the stakeholder table", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--with-research",
      "--with-stakeholders",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Scoping agent output");
    expect(res.stdout).toContain("Research agent output");
    expect(res.stdout).toContain("Stakeholder mapping output");
    expect(res.stdout).toContain("Name");
    expect(res.stdout).toContain("Category");
    expect(res.stdout).toContain("Position");
    expect(res.stdout).toContain("Power");
    expect(res.stdout).toContain("Priority");
    expect(res.stdout).toContain("Key dynamics");
    expect(res.stdout).toContain("Blind spots");
    // At least one stakeholder's Evidence line must be a URL under strict policy.
    expect(res.stdout).toMatch(/Evidence:\s+https?:\/\//);
  });

  test("--with-stakeholders alone emits the implication note and runs the full pipeline", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--with-stakeholders",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("--with-stakeholders implies --with-research");
    expect(res.stdout).toContain("Scoping agent output");
    expect(res.stdout).toContain("Research agent output");
    expect(res.stdout).toContain("Stakeholder mapping output");
  });

  test("--with-stakeholders --json emits combined { scoping, research, stakeholders } object", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--with-stakeholders",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(typeof parsed.scoping.reformulated_question).toBe("string");
    expect(Array.isArray(parsed.research.findings)).toBe(true);
    expect(Array.isArray(parsed.stakeholders.stakeholders)).toBe(true);
    expect(parsed.stakeholders.stakeholders.length).toBeGreaterThanOrEqual(5);
    // Strict-policy shipped fixture: every position_evidence must be sourced.
    for (const s of parsed.stakeholders.stakeholders) {
      expect(s.position_evidence.status).not.toBe("SOURCE_MISSING");
      expect(typeof s.position_evidence.url).toBe("string");
    }
    expect(parsed.stakeholders.key_dynamics.length).toBeGreaterThanOrEqual(3);
    expect(["high", "medium", "low"]).toContain(parsed.stakeholders.coverage_confidence);
  });

  test("--with-stakeholders works with mckinsey-style-note", () => {
    const res = runCli([
      "brief",
      "Should we enter Germany?",
      "--format",
      "mckinsey-style-note",
      "--with-stakeholders",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.stakeholders.stakeholders.length).toBeGreaterThanOrEqual(5);
  });

  test("--with-stakeholders works with position-paper-corporate", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "position-paper-corporate",
      "--with-stakeholders",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.stakeholders.stakeholders.length).toBeGreaterThanOrEqual(5);
  });

  test("--with-stakeholders --provider anthropic without ANTHROPIC_API_KEY exits 1 with a clear error", () => {
    const res = runCli(
      [
        "brief",
        "Q",
        "--format",
        "executive-pre-read",
        "--with-stakeholders",
        "--provider",
        "anthropic",
      ],
      { ANTHROPIC_API_KEY: "" }
    );
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("ANTHROPIC_API_KEY");
    expect(res.stderr).toContain("CONTRIBUTING.md");
  });

  test("help mentions --with-stakeholders", () => {
    const res = runCli(["help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("--with-stakeholders");
  });
});
