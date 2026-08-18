/**
 * End-to-end integration test for the Synthesis agent (v0.6, mock
 * provider). Drives the full pipeline through --full so the
 * per-section synthesis fixtures are exercised and format-conformance
 * checks (forbidden_terms, max_length, no-invention) run against
 * realistic content.
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

describe("integration — synthesis agent via --full --json (mock)", () => {
  test("synthesis.sections mirrors format.sections[] verbatim (id + title + order)", () => {
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
    expect(parsed.synthesis.sections).toHaveLength(6);
    const ids = parsed.synthesis.sections.map(
      (s: { section_id: string }) => s.section_id
    );
    expect(ids).toEqual([
      "context",
      "key-question",
      "recommendation",
      "supporting-evidence",
      "risks-and-mitigations",
      "next-steps",
    ]);
  });

  test("every cited source in synthesis is present in an upstream artefact", () => {
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
    const known = new Set<string>();
    for (const f of parsed.research.findings) {
      if (f.source.url) known.add(f.source.url);
    }
    for (const s of parsed.stakeholders.stakeholders) {
      if (s.position_evidence.url) known.add(s.position_evidence.url);
    }
    for (const r of parsed.risks.risks) {
      if (r.likelihood_evidence.url) known.add(r.likelihood_evidence.url);
      if (r.impact_evidence.url) known.add(r.impact_evidence.url);
    }
    for (const o of parsed.options.options) {
      if (o.supporting_evidence.url) known.add(o.supporting_evidence.url);
    }
    for (const s of parsed.synthesis.sections) {
      for (const src of s.sources_cited) {
        expect(known.has(src.url)).toBe(true);
      }
    }
  });

  test("format_conformance reconciles totals", () => {
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
    const sum = parsed.synthesis.sections.reduce(
      (acc: number, s: { word_count: number }) => acc + s.word_count,
      0
    );
    expect(sum).toBe(parsed.synthesis.total_word_count);
    expect(parsed.synthesis.format_conformance.actual_words).toBe(sum);
  });

  test("the executive-pre-read run produces clean sections (no forbidden_terms hits)", () => {
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
    expect(parsed.synthesis.format_conformance.forbidden_terms_found).toEqual(
      []
    );
  });

  test("synthesis works on mckinsey-style-note", () => {
    const res = runCli([
      "brief",
      "Should we enter Germany?",
      "--format",
      "mckinsey-style-note",
      "--full",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.synthesis.sections.map((s: { section_id: string }) => s.section_id)).toEqual([
      "situation",
      "complication",
      "key-question",
      "answer",
      "supporting-arguments",
      "so-what",
    ]);
  });

  test("synthesis works on position-paper-corporate", () => {
    const res = runCli([
      "brief",
      "Should we enter the German market?",
      "--format",
      "position-paper-corporate",
      "--full",
      "--json",
    ]);
    expect(res.code).toBe(0);
    const parsed = JSON.parse(res.stdout.trim());
    expect(parsed.synthesis.sections.map((s: { section_id: string }) => s.section_id)).toEqual([
      "issue-framing",
      "stakeholder-landscape",
      "our-position",
      "rationale",
      "counter-arguments-addressed",
      "recommended-actions",
    ]);
  });
});
