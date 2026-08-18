/**
 * End-to-end integration test for `praxis brief --with-risks` (v0.5).
 *
 * Spawns the CLI as a real child process (via bun) with the mock
 * provider and verifies the observable contract:
 *
 *   - `--with-research --with-stakeholders --with-risks` exits 0 and
 *     prints the four agent sections plus the aggregated sourcing
 *     report.
 *   - `--with-risks` alone works (implies --with-stakeholders and
 *     --with-research) and prints the implication note to stdout.
 *   - `--with-risks --json` prints a parseable
 *     `{ scoping, research, stakeholders, risks, sourcing_report }`.
 *   - `--sourcing-report` alone prints ONLY the report.
 *   - `--with-risks --provider anthropic` without ANTHROPIC_API_KEY
 *     exits 1 with a clear error.
 *
 * Exercises the full stack: argv → dispatcher → Orchestrator →
 * Scoping → Research → Stakeholders → Risks → sourcing (hardened) →
 * stdout.
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

describe("integration — praxis brief --with-risks (v0.5, mock provider)", () => {
  test("full pipeline: exits 0 and prints all four agent sections + sourcing report", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--with-research",
      "--with-stakeholders",
      "--with-risks",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Scoping agent output");
    expect(res.stdout).toContain("Research agent output");
    expect(res.stdout).toContain("Stakeholder mapping output");
    expect(res.stdout).toContain("Risk analysis output");
    expect(res.stdout).toContain("Sourcing report");
    // Risk table headers.
    expect(res.stdout).toMatch(/ID\s+Category\s+Likelihood/);
    // Aggregated + top-3 rendered.
    expect(res.stdout).toContain("Aggregated risk score");
    expect(res.stdout).toContain("Top-3 priorities");
  });

  test("--with-risks alone emits the implication note and runs the full pipeline", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--with-risks",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain(
      "--with-risks implies --with-stakeholders (and --with-research)"
    );
    expect(res.stdout).toContain("Risk analysis output");
  });

  test("--with-risks --json emits the combined pipeline object", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--with-risks",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.scoping).toBeDefined();
    expect(parsed.research).toBeDefined();
    expect(parsed.stakeholders).toBeDefined();
    expect(parsed.risks).toBeDefined();
    expect(parsed.sourcing_report).toBeDefined();
    expect(parsed.risks.risks.length).toBeGreaterThanOrEqual(5);
    // Every risk has both evidence fields (either sourced or SOURCE_MISSING).
    for (const r of parsed.risks.risks) {
      expect(r.likelihood_evidence).toBeDefined();
      expect(r.impact_evidence).toBeDefined();
      expect(Array.isArray(r.affected_stakeholders)).toBe(true);
      expect(r.affected_stakeholders.length).toBeGreaterThan(0);
    }
    // Sourcing report reconciles.
    const sr = parsed.sourcing_report;
    const sum = sr.counts.ok + sr.counts.stale + sr.counts.untrusted + sr.counts.duplicated + sr.counts.missing;
    expect(sum).toBe(sr.total_items);
  });

  test("--with-risks works with mckinsey-style-note", () => {
    const res = runCli([
      "brief",
      "Should we enter Germany?",
      "--format",
      "mckinsey-style-note",
      "--with-risks",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.risks.risks.length).toBeGreaterThanOrEqual(5);
  });

  test("--with-risks works with position-paper-corporate", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "position-paper-corporate",
      "--with-risks",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.risks.risks.length).toBeGreaterThanOrEqual(5);
  });

  test("--sourcing-report alone prints only the report", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--sourcing-report",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Sourcing report");
    expect(res.stdout).not.toContain("Risk analysis output");
    expect(res.stdout).not.toContain("Scoping agent output");
  });

  test("--with-risks --provider anthropic without ANTHROPIC_API_KEY exits 1", () => {
    const res = runCli(
      [
        "brief",
        "Q",
        "--format",
        "executive-pre-read",
        "--with-risks",
        "--provider",
        "anthropic",
      ],
      { ANTHROPIC_API_KEY: "" }
    );
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("ANTHROPIC_API_KEY");
    expect(res.stderr).toContain("CONTRIBUTING.md");
  });

  test("help mentions --with-risks and --sourcing-report", () => {
    const res = runCli(["help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("--with-risks");
    expect(res.stdout).toContain("--sourcing-report");
  });
});
