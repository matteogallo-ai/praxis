/**
 * End-to-end integration tests for `briefWithCritique` (v0.7).
 *
 * Spawns the CLI as a real child process (via bun), like the other
 * integration tests, so we exercise the full argv path: parser →
 * dispatcher → Orchestrator → seven agents → stdout / renderer.
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

describe("adversarial-e2e — briefWithCritique via --full --critique", () => {
  test("exits 0, prints the briefing AND the inline critique", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
      "--critique",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("# Should we enter the German market?");
    expect(res.stdout).toContain("Adversarial Critique");
    expect(res.stdout).toContain("Robustness:");
    expect(res.stdout).toMatch(/CRIT-\d{3}/);
  });

  test("all three shipped formats trigger the critique successfully", () => {
    for (const [fmt, q] of [
      ["executive-pre-read", "Should we enter the German market?"],
      ["mckinsey-style-note", "Should we enter Germany?"],
      ["position-paper-corporate", "Should we enter the German market?"],
    ] as const) {
      const res = runCli([
        "brief",
        q,
        "--format",
        fmt,
        "--full",
        "--critique",
      ]);
      expect(res.code).toBe(0);
      expect(res.stdout).toContain("Adversarial Critique");
    }
  });

  test("--critique without --full is a valid parse but skips critique (v0.6 pipeline still runs)", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--critique",
    ]);
    // The --critique flag is only wired inside the --full branch;
    // without --full the CLI stays on the v0.5 pipeline. The exit
    // code stays 0 (no error) and the critique is NOT rendered.
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("Adversarial Critique");
  });

  test("--critique --json emits the adversarial field inside the JSON payload", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
      "--critique",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.adversarial).toBeDefined();
    expect(Array.isArray(parsed.adversarial.critiques)).toBe(true);
    expect(parsed.adversarial.critiques.length).toBeGreaterThanOrEqual(3);
    expect(["high", "medium", "low"]).toContain(
      parsed.adversarial.recommendation_robustness
    );
  });

  test("critique targets all reference real artefacts in the brief", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
      "--critique",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    const sectionIds = new Set(
      parsed.synthesis.sections.map((s: { section_id: string }) => s.section_id)
    );
    const optionIds = new Set(
      parsed.options.options.map((o: { id: string }) => o.id)
    );
    const riskIds = new Set(
      parsed.risks.risks.map((r: { id: string }) => r.id)
    );
    const stakeholderNames = new Set(
      parsed.stakeholders.stakeholders.map((s: { name: string }) => s.name)
    );
    const findingCount = parsed.research.findings.length;
    for (const c of parsed.adversarial.critiques) {
      if (c.target.section_id !== undefined) {
        expect(sectionIds.has(c.target.section_id)).toBe(true);
      }
      if (c.target.option_id !== undefined) {
        expect(optionIds.has(c.target.option_id)).toBe(true);
      }
      if (c.target.risk_id !== undefined) {
        expect(riskIds.has(c.target.risk_id)).toBe(true);
      }
      if (c.target.stakeholder_name !== undefined) {
        expect(stakeholderNames.has(c.target.stakeholder_name)).toBe(true);
      }
      if (c.target.finding_index !== undefined) {
        expect(c.target.finding_index).toBeLessThan(findingCount);
      }
    }
  });
});
