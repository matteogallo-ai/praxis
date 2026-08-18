/**
 * End-to-end integration test for the Options Generation agent
 * (v0.6, mock provider).
 *
 * Spawns the CLI as a real child process and drives the full pipeline
 * through --full so the mock Options fixture is exercised in-context
 * with cross-artefact validation active.
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

describe("integration — options agent via --full --json (mock)", () => {
  test("options block appears with 2-4 entries, exactly one recommended", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(Array.isArray(parsed.options.options)).toBe(true);
    expect(parsed.options.options.length).toBeGreaterThanOrEqual(2);
    expect(parsed.options.options.length).toBeLessThanOrEqual(4);
    const recs = parsed.options.options.filter(
      (o: { recommendation_level: string }) => o.recommendation_level === "recommended"
    );
    expect(recs).toHaveLength(1);
    expect(recs[0].id).toBe(parsed.options.recommended_option_id);
  });

  test("every stakeholder_impact.stakeholder_name is a known stakeholder", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    const known = new Set(
      parsed.stakeholders.stakeholders.map(
        (s: { name: string }) => s.name
      )
    );
    for (const o of parsed.options.options) {
      for (const si of o.stakeholder_impact) {
        expect(known.has(si.stakeholder_name)).toBe(true);
      }
    }
  });

  test("every risks_mitigated / risks_introduced entry is a known risk id", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    const knownIds = new Set(
      parsed.risks.risks.map((r: { id: string }) => r.id)
    );
    for (const o of parsed.options.options) {
      for (const rid of o.risks_mitigated) expect(knownIds.has(rid)).toBe(true);
      for (const rid of o.risks_introduced) expect(knownIds.has(rid)).toBe(true);
    }
  });

  test("options block ships every tradeoff with a non-vague dimension", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    const vague = new Set([
      "pros",
      "cons",
      "advantages",
      "disadvantages",
      "strengths",
      "weaknesses",
    ]);
    for (const o of parsed.options.options) {
      for (const t of o.tradeoffs) {
        expect(vague.has(t.dimension.toLowerCase())).toBe(false);
      }
    }
  });

  test("options e2e works on all three shipped formats", () => {
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
        "--json",
      ]);
      expect(res.code).toBe(0);
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.options.options.length).toBeGreaterThanOrEqual(2);
    }
  });
});
