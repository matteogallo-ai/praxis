/**
 * End-to-end integration test for the FULL v0.6 briefing pipeline
 * (mock provider). Spawns the CLI as a child process and asserts on
 * the Markdown-briefing observable contract, on file writing via
 * --output, on JSON emission via --json, and on the sourcing report
 * appendix via --with-sourcing-report.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

describe("integration — full brief (v0.6, mock provider)", () => {
  test("--full prints a self-contained Markdown briefing with YAML header", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout.startsWith("---\n")).toBe(true);
    expect(res.stdout).toContain("question: \"Should we enter the German market?\"");
    expect(res.stdout).toContain("format: \"executive-pre-read\"");
    expect(res.stdout).toContain("provider: \"mock\"");
    expect(res.stdout).toContain("recommended_option: \"OPT-A\"");
    expect(res.stdout).toContain("# Should we enter the German market?");
    // Every section heading appears in declared order.
    const headings = [
      "## Context",
      "## Key Question",
      "## Recommendation",
      "## Supporting Evidence",
      "## Risks and Mitigations",
      "## Next Steps",
    ];
    let cursor = 0;
    for (const h of headings) {
      const idx = res.stdout.indexOf(h, cursor);
      expect(idx).toBeGreaterThanOrEqual(cursor);
      cursor = idx + h.length;
    }
  });

  test("--full --output writes a briefing file and stderr confirms", () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-brief-e2e-"));
    const path = join(dir, "brief.md");
    try {
      const res = runCli([
        "brief",
        "Should we enter the German market?",
        "--format",
        "executive-pre-read",
        "--full",
        "--output",
        path,
      ]);
      expect(res.code).toBe(0);
      expect(res.stdout).toBe("");
      expect(res.stderr).toContain(path);
      const md = readFileSync(path, "utf-8");
      expect(md.startsWith("---\n")).toBe(true);
      expect(md).toContain("# Should we enter the German market?");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--full --json emits a parseable BriefResult", () => {
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
    expect(parsed.scoping.reformulated_question.length).toBeGreaterThan(20);
    expect(parsed.synthesis.sections).toHaveLength(6);
    expect(parsed.options.options.length).toBeGreaterThanOrEqual(2);
    // Sourcing report reconciles.
    const sr = parsed.sourcing_report;
    const sum = sr.counts.ok + sr.counts.stale + sr.counts.untrusted + sr.counts.duplicated + sr.counts.missing;
    expect(sum).toBe(sr.total_items);
  });

  test("--full --with-sourcing-report appends the report under the briefing", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "executive-pre-read",
      "--full",
      "--with-sourcing-report",
    ]);
    expect(res.code).toBe(0);
    const idxBrief = res.stdout.indexOf("# Should we enter");
    const idxReport = res.stdout.indexOf("# Sourcing Report");
    expect(idxBrief).toBeGreaterThanOrEqual(0);
    expect(idxReport).toBeGreaterThan(idxBrief);
    expect(res.stdout).toContain("**Policy:** strict");
  });

  test("--full works with mckinsey-style-note and yields a Situation/Complication/Answer trace", () => {
    const res = runCli([
      "brief",
      "Should we enter Germany?",
      "--format",
      "mckinsey-style-note",
      "--full",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("## Situation");
    expect(res.stdout).toContain("## Complication");
    expect(res.stdout).toContain("## Answer");
    expect(res.stdout).toContain("## So What");
  });

  test("--full without --format exits 1 with a usage hint", () => {
    const res = runCli(["brief", "Q", "--full"]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("--format is required");
  });

  test("--full --provider anthropic without ANTHROPIC_API_KEY exits 1 with clear error", () => {
    const res = runCli(
      [
        "brief",
        "Q",
        "--format",
        "executive-pre-read",
        "--full",
        "--provider",
        "anthropic",
      ],
      { ANTHROPIC_API_KEY: "" }
    );
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("ANTHROPIC_API_KEY");
  });

  test("help mentions --full and --output", () => {
    const res = runCli(["help"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("--full");
    expect(res.stdout).toContain("--output");
    expect(res.stdout).toContain("--with-sourcing-report");
  });

  test("briefing has no forbidden_terms hits (clean mock fixtures)", () => {
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
    expect(parsed.synthesis.format_conformance.forbidden_terms_found).toEqual([]);
  });
});
