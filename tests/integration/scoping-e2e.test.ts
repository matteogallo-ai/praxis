/**
 * End-to-end integration test — spawns the `praxis` CLI as a real
 * child process and verifies the observable contract of the v0.2
 * `brief` command:
 *
 *   - `praxis brief "<question>" --format <id>` exits 0 and prints the
 *     four ScopingResult fields in pretty JSON.
 *   - `--json` mode prints raw parseable JSON.
 *   - Unknown format id and unsupported provider both exit 1.
 *
 * The test exercises the full stack: argv → dispatcher → Orchestrator
 * → Scoping agent → PromptLang parse → MockLLMProvider → JSON parse →
 * stdout.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const CLI = resolve(REPO_ROOT, "src", "cli", "index.ts");

function runCli(argv: readonly string[]) {
  const res = spawnSync("bun", ["run", CLI, ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

describe("integration — praxis brief (v0.2 scoping-only)", () => {
  test("nominal run: exits 0 and prints all four ScopingResult fields", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Scoping agent output");
    expect(res.stdout).toContain("reformulated_question");
    expect(res.stdout).toContain("hidden_questions");
    expect(res.stdout).toContain("scope_boundaries");
    expect(res.stdout).toContain("assumptions_to_validate");
    // v0.6: the trailer points at --full (was "coming in v0.6+" pre-v0.6).
    expect(res.stdout).toContain("--full");
  });

  test("--json emits standalone parseable JSON with the four fields", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(typeof parsed.reformulated_question).toBe("string");
    expect(Array.isArray(parsed.hidden_questions)).toBe(true);
    expect(Array.isArray(parsed.scope_boundaries)).toBe(true);
    expect(Array.isArray(parsed.assumptions_to_validate)).toBe(true);
    expect(parsed.hidden_questions.length).toBeGreaterThan(0);
  });

  test("unknown format exits 1 with clear error", () => {
    const res = runCli([
      "brief",
      "Whatever",
      "--format",
      "does-not-exist",
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("No format registered");
  });

  test("unsupported provider exits 1 with a clear message", () => {
    const res = runCli([
      "brief",
      "Whatever",
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

  test("help mentions the brief command", () => {
    const res = runCli(["help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("praxis brief");
  });
});
