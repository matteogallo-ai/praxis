/**
 * End-to-end integration tests for the renderer pipeline (v0.7).
 *
 * Drives `praxis brief ... --full --render <target> --output <path>`
 * as a real child process for every combination of shipped format
 * and target the format's output_targets[] allows. Then inspects
 * the file on disk with magic-byte checks.
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

// Format → allowed targets (matches formats/*.yaml).
const FORMAT_TARGETS: Record<string, readonly ("md-enhanced" | "docx" | "pdf")[]> = {
  "executive-pre-read": ["md-enhanced", "pdf"],
  "mckinsey-style-note": ["docx", "pdf"],
  "position-paper-corporate": ["docx", "pdf"],
};

const QUESTIONS: Record<string, string> = {
  "executive-pre-read": "Should we enter the German market?",
  "mckinsey-style-note": "Should we enter Germany?",
  "position-paper-corporate": "Should we enter the German market?",
};

describe("render-pipeline-e2e — every allowed (format, target) combination", () => {
  for (const [fmt, targets] of Object.entries(FORMAT_TARGETS)) {
    for (const target of targets) {
      test(`${fmt} × ${target} produces a valid file > 1 KiB`, () => {
        const dir = mkdtempSync(join(tmpdir(), "praxis-e2e-render-"));
        const path = join(dir, `brief.${target === "md-enhanced" ? "md" : target}`);
        try {
          const res = runCli([
            "brief",
            QUESTIONS[fmt]!,
            "--format", fmt,
            "--full",
            "--render", target,
            "--output", path,
          ]);
          expect(res.code).toBe(0);
          const buf = readFileSync(path);
          expect(buf.length).toBeGreaterThan(1024);
          if (target === "pdf") {
            expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
          } else if (target === "docx") {
            expect(buf[0]).toBe(0x50);
            expect(buf[1]).toBe(0x4b);
          } else {
            const text = buf.toString("utf-8");
            expect(text.startsWith("---\n")).toBe(true);
            expect(text).toContain("## Sources");
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
    }
  }
});

describe("render-pipeline-e2e — dispatcher error paths", () => {
  test("target not declared in output_targets rejects with a clear error", () => {
    // executive-pre-read declares [pdf, md] — NOT docx.
    const dir = mkdtempSync(join(tmpdir(), "praxis-e2e-render-err-"));
    const path = join(dir, "brief.docx");
    try {
      const res = runCli([
        "brief",
        "Q",
        "--format", "executive-pre-read",
        "--full", "--render", "docx",
        "--output", path,
      ]);
      expect(res.code).toBe(1);
      expect(res.stderr).toContain("does not declare 'docx'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unknown target rejects with a clear error", () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-e2e-render-unk-"));
    const path = join(dir, "brief.epub");
    try {
      const res = runCli([
        "brief",
        "Q",
        "--format", "executive-pre-read",
        "--full", "--render", "epub",
        "--output", path,
      ]);
      expect(res.code).toBe(1);
      expect(res.stderr).toContain("does not declare 'epub'");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--render without --output rejects", () => {
    const res = runCli([
      "brief", "Q",
      "--format", "executive-pre-read",
      "--full", "--render", "pdf",
    ]);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("--render requires --output");
  });
});

describe("render-pipeline-e2e — --critique combined with --render", () => {
  test("--critique --render pdf includes the critique in the PDF (via file size proxy)", () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-e2e-render-crit-"));
    const noCrit = join(dir, "no-crit.pdf");
    const withCrit = join(dir, "with-crit.pdf");
    try {
      let res = runCli([
        "brief", "Should we enter the German market?",
        "--format", "executive-pre-read",
        "--full", "--render", "pdf",
        "--output", noCrit,
      ]);
      expect(res.code).toBe(0);
      res = runCli([
        "brief", "Should we enter the German market?",
        "--format", "executive-pre-read",
        "--full", "--critique", "--render", "pdf",
        "--output", withCrit,
      ]);
      expect(res.code).toBe(0);
      const noCritSize = readFileSync(noCrit).length;
      const withCritSize = readFileSync(withCrit).length;
      // With critique adds pages → larger PDF.
      expect(withCritSize).toBeGreaterThan(noCritSize);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--include-toc + --include-appendices grows the PDF", () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-e2e-render-full-"));
    const bare = join(dir, "bare.pdf");
    const rich = join(dir, "rich.pdf");
    try {
      let res = runCli([
        "brief", "Should we enter the German market?",
        "--format", "executive-pre-read",
        "--full", "--render", "pdf",
        "--output", bare,
      ]);
      expect(res.code).toBe(0);
      res = runCli([
        "brief", "Should we enter the German market?",
        "--format", "executive-pre-read",
        "--full", "--render", "pdf",
        "--include-toc", "--include-appendices",
        "--output", rich,
      ]);
      expect(res.code).toBe(0);
      expect(readFileSync(rich).length).toBeGreaterThan(readFileSync(bare).length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--theme consulting renders successfully on PDF", () => {
    const dir = mkdtempSync(join(tmpdir(), "praxis-e2e-render-theme-"));
    const path = join(dir, "brief.pdf");
    try {
      const res = runCli([
        "brief", "Should we enter the German market?",
        "--format", "executive-pre-read",
        "--full", "--render", "pdf",
        "--theme", "consulting",
        "--output", path,
      ]);
      expect(res.code).toBe(0);
      const buf = readFileSync(path);
      expect(buf.slice(0, 5).toString("ascii")).toBe("%PDF-");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
